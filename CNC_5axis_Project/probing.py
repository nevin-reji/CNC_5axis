"""Finding the workpiece: camera first (coarse), touch probe second (fine).

A rectangular block (80 x 50 mm) is clamped by hand, so it is never exactly
where the program expects: a few millimetres off and a few degrees turned.
Machining it without measuring would cut in the wrong place.

1. Vision (coarse). An overhead camera image is thresholded (Otsu's method),
   cleaned (morphological opening), and the biggest blob is taken as the part.
   Its centroid gives the position and its second moments (the direction it is
   longest in) give the rotation. Fast, but only accurate to ~0.5 mm, because
   of pixel size, lighting and camera calibration error.
2. Touch probe (fine). A probe in the spindle moves toward an edge until it
   touches (accuracy ~2 um). Points on the long edge give a straight line by
   least squares (its angle = part rotation); points on the short edge give
   where the corner is. The probe must start near the edge: if the part is
   further away than its search travel, it misses. The camera tells it where to start.
Run: python3 probing.py -> results/probing.png, results/probing.json
"""
import json
import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from scipy import ndimage

L, W = 80.0, 50.0                          # block size (mm)
NOMINAL = np.array([-40.0, -25.0, 0.0])    # expected corner x, y (mm) and angle (deg)
PX = 2.5                                   # camera pixels per mm (0.4 mm pixels)
FOV = 160.0                                # camera field of view (mm), centred on the table
CAM_SCALE_ERR, CAM_SHIFT = 0.005, np.array([0.3, -0.2])   # residual camera calibration error
PROBE_SIGMA = 0.002                        # probe repeatability (mm)
SEARCH = 3.0                               # probe starts 3 mm before the expected edge, travels 6 mm


def rot(deg):
    a = np.radians(deg)
    return np.array([[np.cos(a), -np.sin(a)], [np.sin(a), np.cos(a)]])


def to_table(pts, pose):
    """Part coordinates (corner = origin, x along the long edge) -> table coordinates."""
    return np.asarray(pts) @ rot(pose[2]).T + pose[:2]


def to_part(pts, pose):
    return (np.asarray(pts) - pose[:2]) @ rot(pose[2])


def random_pose(rng, max_shift=6.0, max_deg=4.0):
    return NOMINAL + np.array([*rng.uniform(-max_shift, max_shift, 2), rng.uniform(-max_deg, max_deg)])


def render(pose, rng):
    n = int(FOV * PX)
    yy, xx = np.mgrid[0:n, 0:n]
    tx, ty = (xx + .5) / PX - FOV / 2, (yy + .5) / PX - FOV / 2          # table mm at each pixel
    # what the camera thinks is (tx, ty) is really slightly scaled and shifted
    real = np.stack([tx, ty], -1) * (1 + CAM_SCALE_ERR) + CAM_SHIFT
    p = to_part(real.reshape(-1, 2), pose).reshape(n, n, 2)
    inside = (p[..., 0] >= 0) & (p[..., 0] <= L) & (p[..., 1] >= 0) & (p[..., 1] <= W)
    img = 0.25 + 0.5 * inside + 0.15 * (xx / n)                           # part brighter, uneven light
    for _ in range(25):                                                   # bright metal chips on the table
        cx, cy = rng.uniform(0, n, 2)
        img[(xx - cx) ** 2 + (yy - cy) ** 2 < rng.uniform(1, 9)] = 0.9
    return np.clip(img + rng.normal(0, 0.05, img.shape), 0, 1)


def otsu(img):
    """Threshold that best separates dark and bright pixels (max between-class variance)."""
    h, edges = np.histogram(img, 256, (0, 1))
    p = h / h.sum(); c = (edges[:-1] + edges[1:]) / 2
    w0 = np.cumsum(p); m = np.cumsum(p * c); mt = m[-1]
    var = (mt * w0 - m) ** 2 / (w0 * (1 - w0) + 1e-12)
    return c[np.argmax(var)]


def vision(img):
    """Coarse pose from one image: threshold -> clean -> biggest blob -> moments."""
    mask = ndimage.binary_opening(img > otsu(img), iterations=3)          # removes the chips
    lab, n = ndimage.label(mask)
    blob = lab == 1 + np.argmax(ndimage.sum(mask, lab, range(1, n + 1)))
    ys, xs = np.nonzero(blob)
    x, y = (xs + .5) / PX - FOV / 2, (ys + .5) / PX - FOV / 2
    c = np.array([x.mean(), y.mean()])
    cov = np.cov(np.vstack([x - c[0], y - c[1]]))
    evals, evecs = np.linalg.eigh(cov)
    d = evecs[:, 1]                                                       # direction of the long side
    ang = np.degrees(np.arctan2(d[1], d[0]))
    ang = (ang + 90) % 180 - 90                                           # a line has no front/back
    corner = c - rot(ang) @ np.array([L / 2, W / 2])
    return np.array([*corner, ang]), blob


def probe_touch(start, direction, pose, rng):
    """Move from start along direction for up to 2*SEARCH mm; return the touch point or None."""
    s0, d = to_part([start], pose)[0], direction @ rot(pose[2])          # work in part coordinates
    hits = []
    for axis, val in ((1, 0.0), (0, 0.0)):                                # bottom edge y=0, left edge x=0
        if abs(d[axis]) < 1e-9:
            continue
        s = (val - s0[axis]) / d[axis]
        q = s0 + s * d
        other = q[1 - axis]
        if 0 <= s <= 2 * SEARCH and 0 <= other <= (L if axis == 1 else W):
            hits.append(s)
    if not hits:
        return None
    s = min(hits) + rng.normal(0, PROBE_SIGMA)
    return np.asarray(start) + s * np.asarray(direction)


def probe(prior, pose, rng, n_long=3, n_short=2):
    """Probe n_long points on the long edge and n_short on the short edge, starting
    from where the prior pose says the edges are. Returns the fitted pose or None (missed)."""
    R = rot(prior[2])
    long_pts, short_pts = [], []
    for f in np.linspace(0.15, 0.85, n_long):                              # along the bottom edge, moving +y'
        exp = to_table([[f * L, 0]], prior)[0]
        d = R @ np.array([0, 1.0])
        p = probe_touch(exp - SEARCH * d, d, pose, rng)
        if p is None:
            return None, None
        long_pts.append(p)
    for f in np.linspace(0.3, 0.7, n_short):                               # along the left edge, moving +x'
        exp = to_table([[0, f * W]], prior)[0]
        d = R @ np.array([1.0, 0])
        p = probe_touch(exp - SEARCH * d, d, pose, rng)
        if p is None:
            return None, None
        short_pts.append(p)
    A, B = np.array(long_pts), np.array(short_pts)
    # least-squares line through the long-edge points (principal direction)
    ca = A.mean(0)
    u = np.linalg.svd(A - ca)[2][0]
    u = u if u[0] > 0 else -u
    ang = np.degrees(np.arctan2(u[1], u[0]))
    # the short edge is perpendicular to it (rectangular block) and passes through the mean of its points
    cb = B.mean(0)
    nrm = u                                                               # short edge: points p with (p - cb).u = 0
    t = (cb - ca) @ nrm                                                   # corner = ca + t u
    corner = ca + t * u
    return np.array([*corner, ang]), (A, B)


def part_error(est, pose):
    """Worst position error (mm) over the part's four corners if we machine with
    the estimated pose instead of the true one."""
    c = np.array([[0, 0], [L, 0], [L, W], [0, W]])
    return float(np.max(np.linalg.norm(to_table(c, est) - to_table(c, pose), axis=1)))


def main():
    N = 300
    rows = {k: [] for k in ("No measurement (assume nominal)", "Vision only", "Probe only (blind start)", "Vision + probe")}
    for i in range(N):
        rng = np.random.default_rng(i)
        pose = random_pose(rng)
        v, _ = vision(render(pose, rng))
        pb, _ = probe(NOMINAL, pose, rng)
        vp, _ = probe(v, pose, rng)
        rows["No measurement (assume nominal)"].append(part_error(NOMINAL, pose))
        rows["Vision only"].append(part_error(v, pose))
        rows["Probe only (blind start)"].append(None if pb is None else part_error(pb, pose))
        rows["Vision + probe"].append(None if vp is None else part_error(vp, pose))
    summary = {}
    for k, r in rows.items():
        ok = [x for x in r if x is not None]
        summary[k] = dict(success=len(ok) / N, mean_err_mm=float(np.mean(ok)), max_err_mm=float(np.max(ok)))
        print(f"{k:32s} success {100 * len(ok) / N:5.1f}%  mean error {np.mean(ok):7.3f} mm  worst {np.max(ok):7.3f} mm")

    npts = [2, 3, 5, 8, 12]
    ang_err = []
    for n in npts:
        e = []
        for i in range(200):
            rng = np.random.default_rng(5000 + i)
            pose = random_pose(rng, 1, 1)
            est, _ = probe(pose + [0.5, 0.5, 0.3], pose, rng, n_long=n)
            e.append(abs(est[2] - pose[2]) * 3600)                       # arc-seconds
        ang_err.append(float(np.mean(e)))
        print(f"{n:2d} long-edge probe points: mean angle error {ang_err[-1]:.1f} arc-seconds")

    # Figure
    rng = np.random.default_rng(42)
    pose = random_pose(rng)
    img = render(pose, rng)
    v, blob = vision(img)
    vp, (A, B) = probe(v, pose, rng)
    fig, ax = plt.subplots(2, 2, figsize=(13, 10.5))
    ax = ax.ravel()
    ext = [-FOV / 2, FOV / 2, -FOV / 2, FOV / 2]
    ax[0].imshow(img, cmap="gray", extent=ext, origin="lower"); ax[0].set_title("1. Camera image (chips, uneven light)")
    ax[1].imshow(blob, cmap="gray", extent=ext, alpha=.6, origin="lower")
    box = np.array([[0, 0], [L, 0], [L, W], [0, W], [0, 0]])
    for est, col, lab in ((v, "C1", "vision estimate"), (pose, "C2", "true part")):
        ax[1].plot(*to_table(box, est).T, col, lw=1.2, label=lab)
    ax[1].set_title("2. Otsu + opening + biggest blob + moments"); ax[1].legend(fontsize=7)
    tb = to_table(box, pose)
    ax[2].plot(*tb.T, "C2", lw=1.5, label="true edges")
    ax[2].plot(*to_table(box, vp).T, "k--", lw=.8, label="fitted (vision + probe)")
    for P, d in ((A, rot(v[2]) @ [0, 1]), (B, rot(v[2]) @ [1, 0])):
        for p in P:
            ax[2].annotate("", p, p - SEARCH * d, arrowprops=dict(arrowstyle="->", color="C0"))
            ax[2].plot(*p, "o", color="C3", ms=4)
    ax[2].set(xlim=(tb[:, 0].min() - 6, tb[:, 0].min() + 62), ylim=(tb[:, 1].min() - 6, tb[:, 1].min() + 42),
              aspect="equal", title="3. Probe moves (blue) and touches (red)", xlabel="x (mm)", ylabel="y (mm)")
    ax[2].legend(fontsize=7)
    names = list(summary)
    yy = np.arange(len(names))[::-1]
    ax[3].barh(yy, [summary[n]["mean_err_mm"] for n in names], color=["C7", "C1", "C0", "C2"])
    for y, n in zip(yy, names):
        ax[3].text(summary[n]["mean_err_mm"] * 1.15, y, f"{summary[n]['mean_err_mm']:.3f} mm, found {100 * summary[n]['success']:.0f}%",
                   va="center", fontsize=8)
    ax[3].set_yticks(yy, [n.replace(" (", "\n(") for n in names], fontsize=8)
    ax[3].set(xscale="log", xlim=(1e-3, 60), xlabel="mean worst-corner error (mm, log)", title="4. Error over 300 random placements")
    for a in ax[:2]:
        a.set(xlim=(-FOV / 2, FOV / 2), ylim=(-FOV / 2, FOV / 2), xlabel="x (mm)", ylabel="y (mm)")
    fig.tight_layout()
    fig.savefig("results/probing.png", dpi=150, bbox_inches="tight")
    out = dict(methods=summary, probe_points=npts, angle_err_arcsec=ang_err, probe_sigma_mm=PROBE_SIGMA, search_mm=SEARCH)
    json.dump(out, open("results/probing.json", "w"), indent=1)
    return out


if __name__ == "__main__":
    main()
