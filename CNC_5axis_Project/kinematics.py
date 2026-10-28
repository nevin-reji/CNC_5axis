"""Kinematics of a table-tilting 5-axis CNC machine (X, Y, Z + A, C).

The machine
-----------
* The spindle (tool) moves in X, Y, Z and always points straight down the
  machine's Z axis.
* The table carries the part. It tilts about the X axis (A axis) and spins
  about its own centre (C axis). The C table sits on the A trunnion.
* Simplifying assumption: the A and C axes meet at one point, the centre of
  the table top, which is also the origin of both the machine and the part.

What we want vs what we command
-------------------------------
The CAM program describes the cut in PART coordinates: where the tool tip is
(p) and which way the tool points (u, a unit vector). The machine only
understands its five joints q = (X, Y, Z, A, C).

  forward(q)        -> (p, u)   "where is the tool on the part?"
  inverse(p, u)     -> q        "which joint values put it there?"

Everything here uses millimetres and degrees at the interface.
"""
import numpy as np

# Joint limits and speed/acceleration limits of the (desktop-size) machine
LIMITS = {"X": (-150, 150), "Y": (-150, 150), "Z": (-120, 120), "A": (-30, 110), "C": (-1e9, 1e9)}
VMAX = np.array([50, 50, 50, 90, 180])        # mm/s, mm/s, mm/s, deg/s, deg/s
AMAX = np.array([500, 500, 500, 720, 1440])   # mm/s^2 ... deg/s^2
AXES = "XYZAC"


def rot_x(deg):
    a = np.radians(deg)
    return np.array([[1, 0, 0], [0, np.cos(a), -np.sin(a)], [0, np.sin(a), np.cos(a)]])


def rot_z(deg):
    c = np.radians(deg)
    return np.array([[np.cos(c), -np.sin(c), 0], [np.sin(c), np.cos(c), 0], [0, 0, 1]])


def table_rotation(A, C):
    """Rotation that takes a point fixed on the part to machine coordinates:
    first spin with the C table, then tilt with the A trunnion."""
    return rot_x(A) @ rot_z(C)


def forward(q):
    """Joints (X, Y, Z, A, C) -> tool tip p and tool direction u in PART coordinates."""
    X, Y, Z, A, C = q
    R = table_rotation(A, C)
    p = R.T @ np.array([X, Y, Z])            # undo the table rotation
    u = R.T @ np.array([0.0, 0.0, 1.0])      # the tool points along machine +Z
    return p, u


def inverse(p, u, prev=None):
    """Tool tip p and direction u in PART coordinates -> joints (X, Y, Z, A, C).

    From forward(): u = (sinA sinC, sinA cosC, cosA), so
        A = +-acos(u_z),   C = atan2(u_x, u_y)  (C shifts by 180 deg when A is negative).
    There are two solutions; we keep the one inside the A limits that is closest
    to the previous pose, so the machine never makes a needless half-turn.
    At A = 0 (tool vertical) C can be anything: this is the SINGULARITY, and we
    simply keep the previous C."""
    u = np.asarray(u, float) / np.linalg.norm(u)
    A = np.degrees(np.arccos(np.clip(u[2], -1, 1)))
    if A < 1e-6:                                         # singular: C undefined
        C = prev[4] if prev is not None else 0.0
        candidates = [(0.0, C)]
    else:
        C = np.degrees(np.arctan2(u[0], u[1]))
        candidates = [(A, C), (-A, C + 180.0)]
    best = None
    for a, c in candidates:
        if not LIMITS["A"][0] <= a <= LIMITS["A"][1]:
            continue
        if prev is not None:                             # unwrap C next to the previous value
            c = prev[4] + ((c - prev[4] + 180) % 360 - 180)
        cost = 0 if prev is None else abs(a - prev[3]) + abs(c - prev[4])
        if best is None or cost < best[0]:
            best = (cost, a, c)
    if best is None:
        raise ValueError(f"tool direction {u} needs A = {A:.1f} deg, outside the A limits")
    _, A, C = best
    X, Y, Z = table_rotation(A, C) @ np.asarray(p, float)
    return np.array([X, Y, Z, A, C])


def limit_violations(q):
    """Names of the joints outside their travel limits."""
    return [ax for ax, v in zip(AXES, q) if not LIMITS[ax][0] <= v <= LIMITS[ax][1]]


if __name__ == "__main__":
    import json
    # Self-test: inverse then forward must give back the same tool pose
    rng = np.random.default_rng(0)
    worst = 0.0
    for _ in range(1000):
        p = rng.uniform(-40, 40, 3)
        u = rng.normal(size=3); u[2] = abs(u[2]) + 0.2; u /= np.linalg.norm(u)
        q = inverse(p, u)
        p2, u2 = forward(q)
        worst = max(worst, np.abs(p2 - p).max(), np.abs(u2 - u).max())
    print(f"inverse -> forward round trip, 1000 random poses: max error {worst:.2e}")
    # Worked examples for the report: (point, tilt from vertical, direction around)
    examples = []
    for p, tilt, around in (([20, -10, 28], 0, 0), ([10, 0, 20], 30, 90), ([20, 25, 10], 45, 0), ([-15, 5, 12], 60, 225)):
        t, a = np.radians(tilt), np.radians(around)
        u = np.array([np.sin(t) * np.cos(a), np.sin(t) * np.sin(a), np.cos(t)])
        q = inverse(p, u)
        examples.append(dict(p=p, u=np.round(u, 3).tolist(), q=np.round(q, 3).tolist()))
        print("p", p, "u", np.round(u, 3), "->", np.round(q, 3))
    json.dump(dict(roundtrip_max_error=worst, examples=examples), open("results/kinematics.json", "w"), indent=1)
