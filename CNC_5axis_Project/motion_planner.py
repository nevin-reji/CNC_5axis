"""Motion planning: how long may each small move take?

The CAM program asks for a constant cutting feed (tool-tip speed along the
part). On a 5-axis machine that is not always possible: near the top of the
dome the tool is almost vertical (A close to 0, the singularity), and a tiny
step on the part needs a large turn of the C table. So the planner:

  1. starts from the requested feed:          t = distance / feed
  2. velocity limits: no joint may exceed its top speed, so  t >= |dq| / VMAX
  3. acceleration limits: where a joint's speed changes between two moves
     faster than AMAX allows, stretch both moves (repeat until all are OK).

Run: python3 motion_planner.py -> results/toolpath.png, results/feed_planning.png,
     results/dome_finish.ngc (G-code), results/planning.json, sim/toolpath.js
"""
import json
import os
import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

import kinematics as kin
import toolpath as tp

FEED = 20.0      # requested cutting feed, mm/s (1200 mm/min)


def joint_rates(Q, t):
    """Joint velocity of every move (N-1, 5) and acceleration at every junction,
    including starting from and stopping at rest."""
    v = np.diff(Q, axis=0) / t[:, None]
    vz = np.vstack([np.zeros(5), v, np.zeros(5)])
    tt = np.concatenate([[t[0]], t, [t[-1]]])
    a = np.abs(np.diff(vz, axis=0)) / ((tt[:-1] + tt[1:]) / 2)[:, None]
    return v, a


def plan(Q, P, feed=FEED, use_vel=True, use_acc=True, iters=500):
    """Time (s) for each move between consecutive points."""
    t = np.linalg.norm(np.diff(P, axis=0), axis=1) / feed
    if use_vel:
        t = np.maximum(t, (np.abs(np.diff(Q, axis=0)) / kin.VMAX).max(axis=1))
    if use_acc:
        for _ in range(iters):
            _, a = joint_rates(Q, t)
            r = (a / kin.AMAX).max(axis=1)              # worst axis at each junction
            if r.max() <= 1.001:
                break
            s = np.sqrt(np.maximum(r, 1.0))             # accel ~ 1/t^2, so stretch by sqrt
            t = t * np.maximum(s[:-1], s[1:])           # each move touches two junctions
    return t


def report(name, Q, P, t):
    v, a = joint_rates(Q, t)
    d = np.linalg.norm(np.diff(P, axis=0), axis=1)
    return dict(name=name, cycle_s=float(t.sum()),
                max_speed_ratio=float((np.abs(v) / kin.VMAX).max()),
                max_accel_ratio=float((a / kin.AMAX).max()),
                worst_axis_speed=kin.AXES[int(np.argmax((np.abs(v) / kin.VMAX).max(axis=0)))],
                mean_feed=float(d.sum() / t.sum()))


def main():
    os.makedirs("results", exist_ok=True); os.makedirs("sim", exist_ok=True)
    P, U = tp.dome_spiral()
    Q = tp.to_joints(P, U)
    clear = np.array([tp.holder_clearance(p, u) for p, u in zip(P, U)])
    viol = [kin.limit_violations(q) for q in Q]
    print(f"toolpath: {len(P)} points, A range {Q[:, 3].min():.1f}..{Q[:, 3].max():.1f} deg, "
          f"C turned {Q[-1, 4] - Q[0, 4]:.0f} deg; min holder clearance {clear.min():.1f} mm; "
          f"limit violations {sum(map(bool, viol))}")

    cases = [("Constant feed (no limits)", plan(Q, P, use_vel=False, use_acc=False)),
             ("+ joint speed limits", plan(Q, P, use_acc=False)),
             ("+ joint acceleration limits", plan(Q, P))]
    rep = [report(n, Q, P, t) for n, t in cases]
    for r in rep:
        print(f"{r['name']:30s} cycle {r['cycle_s']:6.1f} s  mean feed {r['mean_feed']:5.1f} mm/s  "
              f"max speed {100 * r['max_speed_ratio']:6.0f}% of limit ({r['worst_axis_speed']})  "
              f"max accel {100 * r['max_accel_ratio']:7.0f}% of limit")

    # What the clearance check is for: tilting the tool 80 deg just outside the
    # dome's foot would drive the holder into the dome
    tilt = np.radians(80)
    steep = tp.holder_clearance(tp.OFFSET + [0, tp.BASE_R + 4, 3.0], np.array([0, np.sin(tilt), np.cos(tilt)]))
    print(f"clearance check: tool tilted 80 deg at the dome's foot -> {steep:.1f} mm (collision)")

    t = cases[-1][1]
    T = np.concatenate([[0], np.cumsum(t)])
    feed_planned = np.linalg.norm(np.diff(P, axis=0), axis=1) / t
    v, _ = joint_rates(Q, t)
    write_n = tp.write_gcode(Q, t, "results/dome_finish.ngc")
    Qr, Tr = tp.read_gcode("results/dome_finish.ngc")
    Pr = np.array([kin.forward(q)[0] for q in Qr])
    gerr = float(np.abs(Pr - P[1:]).max())
    print(f"G-code: {write_n} lines; read back and forward kinematics: max tool-point error {gerr:.4f} mm, "
          f"total time {Tr.sum():.1f} s")

    # Figure 1: the toolpath on the dome + joint motion
    fig = plt.figure(figsize=(15, 4.6))
    ax = fig.add_subplot(1, 3, 1, projection="3d")
    th, ph = np.meshgrid(np.linspace(0, 2 * np.pi, 40), np.linspace(0, np.radians(68), 15))
    ax.plot_surface(tp.R_SPHERE * np.sin(ph) * np.cos(th) + tp.OFFSET[0], tp.R_SPHERE * np.sin(ph) * np.sin(th) + tp.OFFSET[1],
                    tp.R_SPHERE * np.cos(ph) - tp.H_CENTRE, color="#c9d6e3", alpha=.5, lw=0)
    ax.plot(*P.T, "C3", lw=.6)
    for k in range(0, len(P), 120):
        ax.quiver(*P[k], *(U[k] * 12), color="k", lw=.7, arrow_length_ratio=.15)
    ax.set(title="Spiral toolpath, tool kept normal to the dome", xlabel="x (mm)", ylabel="y (mm)", zlabel="z (mm)")
    ax.set_box_aspect((1, 1, .55)); ax.view_init(28, -60)
    ax2 = fig.add_subplot(1, 3, 2)
    for k, nm in enumerate("XYZ"):
        ax2.plot(T, Q[:, k], label=f"{nm} (mm)")
    ax2.set(xlabel="time (s)", ylabel="mm", title="Linear axes (planned)"); ax2.legend(fontsize=8)
    ax3 = fig.add_subplot(1, 3, 3)
    ax3.plot(T, Q[:, 3], label="A (deg)"); ax3.plot(T, Q[:, 4], label="C (deg)")
    ax3.set(xlabel="time (s)", ylabel="deg", title="Rotary axes (planned)"); ax3.legend(fontsize=8)
    for a in (ax2, ax3):
        a.grid(alpha=.3)
    fig.savefig("results/toolpath.png", dpi=150, bbox_inches="tight")

    # Figure 2: feed planning
    fig, ax = plt.subplots(1, 3, figsize=(17, 4), gridspec_kw=dict(width_ratios=[1, 1, 1.2]))
    Tm = (T[:-1] + T[1:]) / 2
    ax[0].plot(Tm, feed_planned, lw=.8)
    ax[0].axhline(FEED, color="k", ls="--", lw=.8, label="requested feed")
    ax[0].set(xlabel="time (s)", ylabel="tool speed on the part (mm/s)", xlim=(0, 12),
              title="Planned feed, first 12 s: slow near the top")
    ax[1].plot(Q[1:, 3], np.abs(v[:, 4]), ".", ms=2, label="C speed (planned)")
    t0 = cases[0][1]
    ax[1].plot(Q[1:, 3], np.abs(np.diff(Q[:, 4]) / t0), ".", ms=2, alpha=.5, label="C speed at constant feed")
    ax[1].axhline(kin.VMAX[4], color="r", ls="--", lw=.8, label="C speed limit")
    ax[1].set(xscale="linear", yscale="log", xlabel="A angle (deg)", ylabel="|C speed| (deg/s)",
              title="Why: C must spin fast when A is near 0")
    names = [r["name"] for r in rep]
    yy = np.arange(len(names))[::-1]
    ax[2].barh(yy, [r["cycle_s"] for r in rep], color=["C7", "C0", "C2"])
    for y, r in zip(yy, rep):
        ax[2].text(r["cycle_s"] + 2, y, f"{r['cycle_s']:.0f} s  (peak speed {100 * r['max_speed_ratio']:.0f}%, "
                                        f"accel {100 * r['max_accel_ratio']:.0f}% of limit)", va="center", fontsize=8)
    ax[2].set_yticks(yy, names); ax[2].set(xlabel="cycle time (s)", title="Cycle time vs feasibility",
                                           xlim=(0, max(r["cycle_s"] for r in rep) * 2.2))
    for a in ax[:2]:
        a.grid(alpha=.3); a.legend(fontsize=8)
    fig.tight_layout()
    fig.savefig("results/feed_planning.png", dpi=150, bbox_inches="tight")

    # Data for the 3D browser simulator (a script file works when opened from disk)
    k = np.linspace(0, len(Q) - 1, 900).astype(int)
    sim = dict(t=np.round(T[k], 3).tolist(), q=np.round(Q[k], 3).tolist(), p=np.round(P[k], 2).tolist(),
               R=tp.R_SPHERE, H=tp.H_CENTRE, ball=tp.BALL_R, offset=tp.OFFSET.tolist())
    open("sim/toolpath.js", "w").write("window.TOOLPATH = " + json.dumps(sim) + ";\n")

    out = dict(points=len(P), A_range=[float(Q[:, 3].min()), float(Q[:, 3].max())], C_total=float(Q[-1, 4] - Q[0, 4]),
               min_holder_clearance=float(clear.min()), limit_violations=int(sum(map(bool, viol))),
               steep_tilt_clearance=steep, gcode_lines=write_n, gcode_roundtrip_error=gerr, cases=rep, feed=FEED)
    json.dump(out, open("results/planning.json", "w"), indent=1)
    return out


if __name__ == "__main__":
    main()
