"""Explanatory diagrams for the report: machine axes, servo control loop, ML pipeline.
Run: python3 draw_diagrams.py -> results/machine_axes.png, results/control_loop.png, results/ml_pipeline.png"""
import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.patches import FancyBboxPatch, Circle, Rectangle, FancyArrowPatch, Arc

INK = "#1f2937"


def box(ax, x, y, w, h, text, fc, fs=9):
    ax.add_patch(FancyBboxPatch((x, y), w, h, boxstyle="round,pad=0.02,rounding_size=0.06", fc=fc, ec=INK, lw=1))
    ax.text(x + w / 2, y + h / 2, text, ha="center", va="center", fontsize=fs)
    return x, y, w, h


def arr(ax, p, q, text=None, off=(0, 0.1), color=INK, rad=0.0, fs=8):
    ax.add_patch(FancyArrowPatch(p, q, arrowstyle="-|>", mutation_scale=12, color=color, lw=1.1,
                                 connectionstyle=f"arc3,rad={rad}"))
    if text:
        ax.text((p[0] + q[0]) / 2 + off[0], (p[1] + q[1]) / 2 + off[1], text, ha="center", fontsize=fs, color=color)


def machine_axes():
    fig, ax = plt.subplots(1, 2, figsize=(12, 5.2))
    # Front view (looking along -X): A tilts the table about X
    a = ax[0]
    a.set(xlim=(-110, 110), ylim=(-80, 170), aspect="equal"); a.axis("off")
    a.set_title("Side view: A tilts the table about the X axis", fontsize=11)
    a.add_patch(Rectangle((-100, -75), 200, 12, fc="#d1d5db", ec=INK))
    for s in (-1, 1):
        a.add_patch(Rectangle((s * 85 - 8, -63), 16, 60, fc="#e5e7eb", ec=INK))
    tilt = np.radians(30)
    R = np.array([[np.cos(tilt), -np.sin(tilt)], [np.sin(tilt), np.cos(tilt)]])
    tab = np.array([[-70, -10], [70, -10], [70, 0], [-70, 0]]) @ R.T
    a.add_patch(plt.Polygon(tab, fc="#9ca3af", ec=INK))
    th = np.linspace(0, np.pi, 50)
    dome = np.c_[15 + 40 * np.cos(th) * 0.93, 37 * np.sin(th) - 0] @ R.T
    a.add_patch(plt.Polygon(dome, fc="#cbd5e1", ec=INK))
    a.plot(0, 0, "o", color="#dc2626", ms=6); a.text(4, -14, "pivot (A and C axes\nmeet here)", fontsize=8, color="#dc2626")
    a.add_patch(Arc((0, 0), 150, 150, theta1=0, theta2=30, color="#2563eb", lw=1.5))
    a.text(78, 22, "A", color="#2563eb", fontsize=12, weight="bold")
    tip = np.array([15, 0]) @ R.T + [0, 37]          # where the dome's surface normal is vertical
    a.add_patch(Rectangle((tip[0] - 3, tip[1]), 6, 45, fc="#f59e0b", ec=INK))
    a.add_patch(Rectangle((tip[0] - 14, tip[1] + 45), 28, 40, fc="#374151", ec=INK))
    a.annotate("", (tip[0] + 30, tip[1] + 55), (tip[0] + 30, tip[1] + 20), arrowprops=dict(arrowstyle="<->", color="#16a34a"))
    a.text(tip[0] + 34, tip[1] + 35, "Z", color="#16a34a", fontsize=12, weight="bold")
    a.annotate("", (tip[0] + 45, tip[1] + 98), (tip[0] - 15, tip[1] + 98), arrowprops=dict(arrowstyle="<->", color="#16a34a"))
    a.text(tip[0] + 50, tip[1] + 94, "Y", color="#16a34a", fontsize=12, weight="bold")
    a.text(-105, 165, "tool always points along machine Z;\nthe table carries the part", fontsize=8, va="top")
    # Top view: C spins the table, the part is off-centre
    b = ax[1]
    b.set(xlim=(-100, 100), ylim=(-100, 100), aspect="equal"); b.axis("off")
    b.set_title("Top view: C spins the table; the part is off-centre", fontsize=11)
    b.add_patch(Circle((0, 0), 80, fc="#9ca3af", ec=INK))
    for k in range(4):
        ang = k * np.pi / 4
        b.plot([-75 * np.cos(ang), 75 * np.cos(ang)], [-75 * np.sin(ang), 75 * np.sin(ang)], color="#6b7280", lw=.8)
    b.add_patch(Circle((20, -10), 37, fc="#cbd5e1", ec=INK))
    b.plot(0, 0, "o", color="#dc2626", ms=6)
    b.plot(20, -10, "+", color=INK, ms=10)
    b.annotate("", (20, -10), (0, 0), arrowprops=dict(arrowstyle="->", color="#7c3aed"))
    b.text(22, -32, "part centre offset\n(20, -10) mm", fontsize=8, color="#7c3aed")
    b.add_patch(FancyArrowPatch((86, 34), (34, 86), arrowstyle="-|>", mutation_scale=14, color="#2563eb", lw=1.5,
                                connectionstyle="arc3,rad=0.35"))
    b.text(78, 78, "C", color="#2563eb", fontsize=12, weight="bold")
    b.annotate("", (-60, -88), (-90, -88), arrowprops=dict(arrowstyle="->", color="#16a34a"))
    b.annotate("", (-90, -58), (-90, -88), arrowprops=dict(arrowstyle="->", color="#16a34a"))
    b.text(-56, -92, "X", color="#16a34a", fontsize=11, weight="bold"); b.text(-94, -54, "Y", color="#16a34a", fontsize=11, weight="bold")
    fig.tight_layout()
    fig.savefig("results/machine_axes.png", dpi=170, bbox_inches="tight")


def control_loop():
    fig, ax = plt.subplots(figsize=(12, 3.8))
    ax.set(xlim=(0, 12), ylim=(0, 3.8)); ax.axis("off")
    ref = box(ax, 0.1, 1.5, 1.6, 0.8, "Interpolator\nr, v_ref, a_ref", "#fce7f3")
    ax.add_patch(Circle((2.4, 1.9), 0.2, fc="white", ec=INK)); ax.text(2.4, 1.9, "+", ha="center", va="center", fontsize=11)
    ax.text(2.05, 1.45, "−", fontsize=13)
    pid = box(ax, 3.1, 1.5, 1.8, 0.8, "PID\nKp e + Ki∫e + Kd ė", "#dcfce7")
    ff = box(ax, 3.1, 2.75, 1.8, 0.8, "Feedforward\nm a + b v + Fc + mg", "#dcfce7")
    ax.add_patch(Circle((5.6, 1.9), 0.2, fc="white", ec=INK)); ax.text(5.6, 1.9, "+", ha="center", va="center", fontsize=11)
    sat = box(ax, 6.2, 1.5, 1.3, 0.8, "Saturation\n|u| ≤ u_max", "#e5e7eb")
    plant = box(ax, 7.9, 1.5, 2.3, 0.8, "Axis\nm ẍ = u − bẋ − Fc − load", "#e5e7eb", 8.5)
    enc = box(ax, 8.0, 0.2, 2.0, 0.7, "Encoder (1 µm steps)", "#dbeafe")
    arr(ax, (1.7, 1.9), (2.2, 1.9), "r")
    arr(ax, (2.6, 1.9), (3.1, 1.9), "e", off=(0, 0.12))
    arr(ax, (4.9, 1.9), (5.4, 1.9))
    arr(ax, (0.9, 2.3), (3.1, 3.15), "v_ref, a_ref", off=(-0.3, 0.2), rad=-0.2)
    arr(ax, (4.9, 3.15), (5.6, 2.1), "u_ff", off=(0.3, 0.1))
    arr(ax, (5.8, 1.9), (6.2, 1.9), "u", off=(0, 0.12))
    arr(ax, (7.5, 1.9), (8.0, 1.9))
    arr(ax, (10.2, 1.9), (11.4, 1.9), "x (actual)", off=(0, 0.12))
    arr(ax, (10.7, 1.9), (10.0, 0.55), rad=-0.3)
    arr(ax, (8.0, 0.55), (2.4, 1.7), "measured position", off=(0, -0.35), rad=-0.15)
    ax.text(8.1, 2.75, "load: gravity (Z, A),\ncutting force (X, Y)", fontsize=8)
    arr(ax, (9.0, 2.75), (9.0, 2.3))
    fig.savefig("results/control_loop.png", dpi=170, bbox_inches="tight")


def ml_pipeline():
    fig, ax = plt.subplots(figsize=(12, 3.0))
    ax.set(xlim=(0, 12), ylim=(0, 3)); ax.axis("off")
    s1 = box(ax, 0.1, 1.7, 1.8, 0.9, "Spindle current\n(10 kHz)", "#dbeafe")
    s2 = box(ax, 0.1, 0.4, 1.8, 0.9, "Vibration\n(10 kHz)", "#dbeafe")
    w = box(ax, 2.4, 1.0, 1.7, 1.0, "0.1 s windows\n(1000 samples)", "#e5e7eb")
    f = box(ax, 4.6, 0.6, 2.2, 1.8, "8 features\nfeed, current/feed,\nripple, RMS, kurtosis,\nchatter-band share,\ntooth-pass share,\n1x-rev ratio", "#fef3c7", 8.5)
    c = box(ax, 7.3, 1.0, 1.9, 1.0, "Classifier\nrandom forest /\ndecision tree", "#fef3c7")
    a = box(ax, 9.7, 1.0, 2.2, 1.0, "normal → continue\nworn → feed −20%\nchatter → speed +15%\nbroken → stop", "#dcfce7", 8.5)
    arr(ax, (1.9, 2.15), (2.4, 1.7)); arr(ax, (1.9, 0.85), (2.4, 1.3))
    arr(ax, (4.1, 1.5), (4.6, 1.5)); arr(ax, (6.8, 1.5), (7.3, 1.5)); arr(ax, (9.2, 1.5), (9.7, 1.5), "state", off=(0, 0.12))
    fig.savefig("results/ml_pipeline.png", dpi=170, bbox_inches="tight")


if __name__ == "__main__":
    machine_axes()
    control_loop()
    ml_pipeline()
