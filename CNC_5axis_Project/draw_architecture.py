"""System architecture diagram of the intelligent 5-axis CNC.
Run: python3 draw_architecture.py -> results/architecture.png"""
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.patches import FancyBboxPatch

COL = {"plan": "#fce7f3", "ctrl": "#dcfce7", "sense": "#dbeafe", "ml": "#fef3c7", "mech": "#e5e7eb"}


def box(ax, x, y, w, h, text, kind):
    ax.add_patch(FancyBboxPatch((x, y), w, h, boxstyle="round,pad=0.02,rounding_size=0.08",
                                fc=COL[kind], ec="#374151", lw=1))
    ax.text(x + w / 2, y + h / 2, text, ha="center", va="center", fontsize=8.5)
    return x, y, w, h


def arrow(ax, a, b, sa="r", sb="l", text=None, color="#374151", rad=0.0, dy=0.12):
    pt = lambda bx, s: {"r": (bx[0] + bx[2], bx[1] + bx[3] / 2), "l": (bx[0], bx[1] + bx[3] / 2),
                        "t": (bx[0] + bx[2] / 2, bx[1] + bx[3]), "b": (bx[0] + bx[2] / 2, bx[1])}[s]
    p, q = pt(a, sa), pt(b, sb)
    ax.annotate("", q, p, arrowprops=dict(arrowstyle="-|>", color=color, lw=1.1, connectionstyle=f"arc3,rad={rad}"))
    if text:
        ax.text((p[0] + q[0]) / 2 + (0.08 if p[0] == q[0] else 0), (p[1] + q[1]) / 2 + dy, text, ha="left" if p[0] == q[0] else "center", fontsize=7, color=color)


fig, ax = plt.subplots(figsize=(13, 6.6))
ax.set(xlim=(0, 13), ylim=(0, 6.8)); ax.axis("off")
# Planning chain (top)
cam = box(ax, 0.2, 5.0, 2.0, 1.0, "CAM\ndome spiral, tool\nnormal to surface", "plan")
ik = box(ax, 2.7, 5.0, 2.1, 1.0, "Inverse kinematics\n(X,Y,Z,A,C), pick\ncontinuous solution", "plan")
col = box(ax, 5.3, 5.0, 2.0, 1.0, "Collision + limit\ncheck (holder,\ntable, travel)", "plan")
fp = box(ax, 7.8, 5.0, 2.2, 1.0, "Feed planner\njoint speed + accel\nlimits (singularity)", "plan")
gc = box(ax, 10.5, 5.0, 2.3, 1.0, "G-code (G93\ninverse-time feed)", "plan")
for a, b in ((cam, ik), (ik, col), (col, fp), (fp, gc)):
    arrow(ax, a, b)
# Controller + drives (middle)
cnc = box(ax, 10.5, 3.3, 2.3, 1.0, "CNC controller\nLinuxCNC / grblHAL\ninterpolator 1 kHz", "ctrl")
drv = box(ax, 7.5, 3.3, 2.5, 1.0, "5 servo drives\nPID + feedforward\n(pole placement)", "ctrl")
mech = box(ax, 4.6, 3.3, 2.4, 1.0, "Machine: X,Y,Z slides\nA trunnion, C table\nspindle", "mech")
arrow(ax, gc, cnc, "b", "t"); arrow(ax, cnc, drv, "l", "r", "step/\ndir", dy=0.15)
arrow(ax, drv, mech, "l", "r", "motor\ncurrent", dy=0.15)
enc = box(ax, 7.5, 1.9, 2.5, 0.9, "Encoders\n1 um / 0.001 deg", "sense")
arrow(ax, mech, enc, "b", "l", rad=0.25); arrow(ax, enc, drv, "t", "b", "position feedback", dy=0.0)
# Perception (left bottom)
camr = box(ax, 0.2, 1.9, 2.0, 0.9, "Overhead camera", "sense")
vis = box(ax, 0.2, 0.5, 2.0, 1.0, "Vision: Otsu, blob,\nmoments -> coarse\npart pose (0.4 mm)", "ml")
prb = box(ax, 2.6, 0.5, 2.2, 1.0, "Touch probe + least\nsquares -> fine pose\n(3 um)", "sense")
arrow(ax, camr, vis, "b", "t"); arrow(ax, vis, prb, "r", "l", "where to\nprobe", dy=0.3)
arrow(ax, prb, ik, "t", "b", "work offset (G54)", dy=0.0)
# Monitoring (right bottom)
sens = box(ax, 5.3, 0.5, 2.2, 1.0, "Spindle current +\naccelerometer\n(0.1 s windows)", "sense")
mon = box(ax, 8.0, 0.5, 2.3, 1.0, "ML tool monitor\n8 features, random\nforest / decision tree", "ml")
act = box(ax, 10.8, 0.5, 2.0, 1.0, "Adapt: speed +15%,\nfeed -20%, or stop", "ctrl")
arrow(ax, mech, sens, "b", "t"); arrow(ax, sens, mon); arrow(ax, mon, act)
arrow(ax, act, cnc, "t", "b", "feed / speed override", dy=0.0)
handles = [plt.Rectangle((0, 0), 1, 1, fc=c, ec="#374151") for c in COL.values()]
ax.legend(handles, ["planning", "control", "sensing", "AI / vision", "mechanics"], loc="upper left",
          bbox_to_anchor=(0, 0.995), ncol=5, fontsize=8, frameon=False)
fig.savefig("results/architecture.png", dpi=170, bbox_inches="tight")
