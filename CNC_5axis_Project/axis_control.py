"""Servo control of the five axes: PID + feedforward, tuned by pole placement.

Each axis is a motor driving a mass (linear axes) or an inertia (rotary axes):

        m * x'' = u - b * x' - friction - load

u is the motor force (or torque) the controller chooses, b is viscous damping,
friction is Coulomb friction, and load is gravity (Z axis, A trunnion) or the
cutting force (X, Y). The encoder reads the position in steps of 1 um / 0.001 deg.

Controllers compared
  P            u = Kp e
  PID          u = Kp e + Ki * integral(e) + Kd * de/dt
  PID + FF     PID + feedforward  u_ff = m a_ref + b v_ref + friction(v_ref)
               (the force a perfect model says is needed, so the PID only fixes what is left)

Tuning by pole placement: choose how fast the axis should respond (natural
frequency wn) and how damped (zeta = 0.8); then Kp = m wn^2, Kd = 2 zeta wn m - b,
Ki = Kp wn / 10. One number (wn) tunes every axis.
Run: python3 axis_control.py -> results/axis_control.png, results/axis_control.json
"""
import json
import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from scipy.spatial import cKDTree

import kinematics as kin
import toolpath as tp
import motion_planner as mp

DT = 0.001                                     # 1 kHz servo loop
SMOOTH = 0.02                                  # interpolator smoothing window (s)
# Per axis (X, Y, Z in metres; A, C in radians)
M = np.array([6.0, 6.0, 4.0, 0.02, 0.01])      # kg or kg m^2
B = np.array([40.0, 40.0, 40.0, 0.05, 0.02])   # damping
FC = np.array([5.0, 5.0, 5.0, 0.3, 0.2])       # Coulomb friction
UMAX = np.array([300.0, 300.0, 300.0, 6.0, 4.0])
ENC = np.array([1e-6, 1e-6, 1e-6, np.radians(0.001), np.radians(0.001)])
SCALE = np.array([1e-3, 1e-3, 1e-3, np.pi / 180, np.pi / 180])   # mm/deg -> SI
ZETA = 0.8


def gains(wn_hz):
    wn = 2 * np.pi * wn_hz
    kp = M * wn ** 2
    kd = np.maximum(2 * ZETA * wn * M - B, 0)
    return kp, kp * wn / 10, kd


def load(q, v, t, rng_phase):
    """Disturbance on each axis: cutting force on X/Y (15 N, varying), gravity on Z
    (4 kg) and the unbalanced trunnion on A (3 kg at 20 mm)."""
    d = np.zeros(5)
    d[0] = 15 * np.sin(2 * np.pi * 0.7 * t + rng_phase)
    d[1] = 15 * np.cos(2 * np.pi * 0.7 * t + rng_phase)
    d[2] = 4.0 * 9.81
    d[3] = 3.0 * 9.81 * 0.02 * np.sin(q[3])
    return d


def interpolate(t_ref, q_ref):
    """The controller's interpolator: straight lines between the planned points,
    sampled every 1 ms, then a 20 ms moving average that rounds the corners so
    the motors never get an instant change of speed. Returns t and the reference
    position, velocity and acceleration (SI units)."""
    t = np.arange(0, t_ref[-1], DT)
    lin = np.column_stack([np.interp(t, t_ref, q_ref[:, i]) for i in range(5)]) * SCALE
    n = int(SMOOTH / DT)
    pad = np.vstack([np.repeat(lin[:1], n, 0), lin, np.repeat(lin[-1:], n, 0)])
    ker = np.ones(n) / n
    r = np.column_stack([np.convolve(pad[:, i], ker, "same") for i in range(5)])[n:-n]
    rv = np.gradient(r, DT, axis=0)
    ra = np.gradient(rv, DT, axis=0)
    return t, r, rv, ra


def simulate(t_ref, q_ref, mode, wn_hz=25.0, seed=0):
    """Run all five axes along the reference. mode: 'P', 'PID' or 'PID+FF'.
    Returns time, actual joints (mm/deg), reference joints (mm/deg)."""
    rng = np.random.default_rng(seed)
    t, r, rv, ra = interpolate(t_ref, q_ref)
    kp, ki, kd = gains(wn_hz)
    if mode == "P":
        ki, kd = 0 * ki, 0 * kd
    x, v = r[0].copy(), np.zeros(5)
    integ, prev_e, dfilt = np.zeros(5), None, np.zeros(5)
    out = np.empty_like(r)
    phase = rng.uniform(0, 2 * np.pi)
    for k in range(len(t)):
        out[k] = x                                           # actual position at time t[k]
        meas = np.round(x / ENC) * ENC                       # encoder
        e = r[k] - meas
        de = 0 if prev_e is None else (e - prev_e) / DT
        dfilt += 0.3 * (de - dfilt)                          # filtered derivative
        prev_e = e
        u = kp * e + ki * integ + kd * dfilt
        if mode == "PID+FF":
            u += M * ra[k] + B * rv[k] + FC * np.tanh(rv[k] / 1e-4)
            u[2] += 4.0 * 9.81                               # known weight of the Z axis
        u_sat = np.clip(u, -UMAX, UMAX)
        integ += e * DT * (u == u_sat)                       # anti-windup: stop integrating when saturated
        acc = (u_sat - B * v - FC * np.tanh(v / 1e-4) - load(x, v, t[k], phase)) / M
        v += acc * DT
        x += v * DT
    return t, out / SCALE, r / SCALE


def errors(t, q, r):
    """Following error per axis and contour error of the tool on the part."""
    fe = q - r
    Pa = np.array([kin.forward(x)[0] for x in q[::5]])
    Pr = np.array([kin.forward(x)[0] for x in r])
    dist, _ = cKDTree(Pr).query(Pa)
    return dict(rms_follow=np.sqrt((fe ** 2).mean(0)).tolist(), max_follow=np.abs(fe).max(0).tolist(),
                rms_contour_um=float(1000 * np.sqrt((dist ** 2).mean())), max_contour_um=float(1000 * dist.max()),
                fe=fe, contour=dist)


def step_test(mode, axis=2, size=1.0):
    """1 mm step on one axis. The axis first holds position for 0.6 s (so it has
    settled against its load), then the step is commanded; returns the last 0.45 s."""
    t = np.array([0, 0.6, 0.6001, 1.05])
    q = np.zeros((4, 5)); q[2:, axis] = size
    tt, qa, _ = simulate(t, q, mode)
    keep = tt >= 0.55
    return tt[keep] - 0.55, qa[keep, axis]


def main():
    P, U = tp.dome_spiral()
    Q = tp.to_joints(P, U)
    seg = mp.plan(Q, P)
    T = np.concatenate([[0], np.cumsum(seg)])
    res, runs = {}, {}
    for mode in ("P", "PID", "PID+FF"):
        t, q, r = simulate(T, Q, mode)
        e = errors(t, q, r)
        runs[mode] = (t, e)
        res[mode] = {k: v for k, v in e.items() if k not in ("fe", "contour")}
        print(f"{mode:7s} RMS following error X {1000 * e['rms_follow'][0]:7.2f} um  Z {1000 * e['rms_follow'][2]:7.2f} um  "
              f"C {1000 * e['rms_follow'][4]:7.2f} mdeg | contour RMS {e['rms_contour_um']:6.2f} um max {e['max_contour_um']:6.2f} um")

    bw = [5, 10, 25, 50, 80]
    sweep = []
    for w in bw:
        t, q, r = simulate(T, Q, "PID+FF", wn_hz=w)
        e = errors(t, q, r)
        sweep.append(dict(wn_hz=w, rms_contour_um=e["rms_contour_um"], max_contour_um=e["max_contour_um"]))
        print(f"PID+FF wn {w:3d} Hz: contour RMS {e['rms_contour_um']:.2f} um, max {e['max_contour_um']:.2f} um")

    steps = {m: step_test(m) for m in ("P", "PID", "PID+FF")}
    for m, (tt, y) in steps.items():
        print(f"Z step {m:7s}: final {1000 * (y[-1] - 1):+.1f} um, overshoot {1000 * max(y.max() - 1, 0):.1f} um")

    fig, ax = plt.subplots(2, 2, figsize=(14, 8))
    for mode, col in (("P", "C3"), ("PID", "C1"), ("PID+FF", "C2")):
        t, e = runs[mode]
        ax[0, 0].plot(t, 1000 * e["fe"][:, 0], col, lw=.6, label=mode)
        ax[0, 1].plot(t[::5], e["contour"] * 1000, col, lw=.6, label=f"{mode}: RMS {res[mode]['rms_contour_um']:.1f} um")
    ax[0, 0].set(xlabel="time (s)", ylabel="X following error (um)", title="X axis following error along the dome program")
    ax[0, 1].set(xlabel="time (s)", ylabel="contour error (um)", yscale="log", title="Tool error on the part surface (contour error)")
    for m, (tt, y) in steps.items():
        ax[1, 0].plot(1000 * tt, 1000 * y, label=m)
    ax[1, 0].set(xlabel="time (ms)", ylabel="Z position (um)", title="Z axis: 1 mm step (commanded at 50 ms) against gravity", xlim=(0, 450))
    ax[1, 1].plot(bw, [s["rms_contour_um"] for s in sweep], "o-", label="RMS")
    ax[1, 1].plot(bw, [s["max_contour_um"] for s in sweep], "s--", label="max")
    ax[1, 1].set(xlabel="tuned bandwidth wn (Hz)", ylabel="contour error (um)", yscale="log",
                 title="Pole-placement tuning: PID+FF error vs bandwidth")
    for a in ax.flat:
        a.grid(alpha=.3); a.legend(fontsize=8)
    fig.tight_layout()
    fig.savefig("results/axis_control.png", dpi=150, bbox_inches="tight")
    kp, ki, kd = gains(25)
    out = dict(controllers=res, bandwidth_sweep=sweep, gains_25Hz=dict(kp=kp.tolist(), ki=ki.tolist(), kd=kd.tolist()),
               z_step={m: dict(final_err_um=float(1000 * (y[-1] - 1)), overshoot_um=float(1000 * max(y.max() - 1, 0)))
                       for m, (tt, y) in steps.items()})
    json.dump(out, open("results/axis_control.json", "w"), indent=1)
    return out


if __name__ == "__main__":
    main()
