"""Intelligent tool monitoring: machine learning on spindle current and vibration.

While cutting, two cheap sensors are read:
  * spindle motor current (a current sensor on the spindle drive), which rises
    with the cutting force,
  * vibration (an accelerometer on the spindle head).
Every 0.1 s window is turned into 8 simple features and a classifier decides:
  0 normal  -  1 worn tool  -  2 chatter  -  3 broken tooth
and the controller reacts (change spindle speed, lower the feed, or stop).

The signals are simulated from simple physics:
  cutting force  = pulses at the tooth-passing frequency (2 flutes x spindle rev/s),
                   bigger with feed and with wear; a broken tooth removes every other pulse;
  vibration      = that force passed through the machine's structural resonance
                   (~1.5 kHz), plus rubbing noise from wear; chatter adds a large
                   self-excited vibration near the resonance;
  current        = idle current + a term proportional to the average force + noise.
Run: python3 tool_monitor.py -> results/tool_monitor.png, results/tool_tree.png, results/tool_monitor.json
"""
import json
import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from scipy import signal, stats
from sklearn.ensemble import RandomForestClassifier
from sklearn.tree import DecisionTreeClassifier, plot_tree
from sklearn.metrics import confusion_matrix, accuracy_score

FS, WIN = 10_000, 0.1                     # sample rate (Hz), window length (s)
CLASSES = ["normal", "worn", "chatter", "broken tooth"]
WORN = 0.4                                # wear level from which a tool counts as worn
IDLE_CURRENT = 2.0                        # spindle current when running but not cutting (A)
FEATURES = ["feed (known)", "cutting current / feed", "current ripple", "vibration RMS",
            "vibration kurtosis", "chatter-band share", "tooth-pass share", "1x-rev / tooth-pass"]


def make_window(state, rng, rpm=None, feed=None, wear=None, material=None):
    """Simulate one window of current and vibration for a tool state. material
    scales the cutting force (soft aluminium ~0.7 ... hard alloy ~1.5) and is NOT
    known to the monitor, which is what makes a fixed current threshold unreliable."""
    rpm = rng.uniform(9000, 15000) if rpm is None else rpm
    material = rng.uniform(0.7, 1.5) if material is None else material
    feed = rng.uniform(0.6, 1.4) if feed is None else feed            # x nominal chip load
    if wear is None:
        wear = rng.uniform(WORN, 1.0) if state == 1 else rng.uniform(0, 0.3)
    t = np.arange(int(FS * WIN)) / FS
    f_rev = rpm / 60
    phase = 2 * np.pi * f_rev * t + rng.uniform(0, 2 * np.pi)
    tooth = np.floor(phase / np.pi).astype(int) % 2                   # which of the 2 teeth is cutting
    pulse = np.maximum(np.sin(2 * phase), 0)                          # one pulse per tooth pass
    force = 100 * material * feed * (1 + 0.8 * wear) * pulse
    if state == 3:                                                    # broken tooth: one tooth cuts nothing,
        force = np.where(tooth == 0, 0.0, 1.8 * force)                # the other takes almost double
    fn = rng.uniform(1300, 1700)                                      # structural resonance
    b, a = signal.iirpeak(fn, 8, FS)
    vib = 0.02 * signal.lfilter(b, a, force) + 0.002 * force
    vib += rng.normal(0, 0.05 + 0.25 * wear, len(t))                  # sensor noise + rubbing of the worn edge
    if state == 2:                                                    # chatter: growing self-excited vibration
        grow = np.minimum(1, 0.3 + t / WIN)
        vib += rng.uniform(4, 8) * grow * np.sin(2 * np.pi * fn * rng.uniform(0.98, 1.02) * t)
        force = force * (1 + 0.15 * np.sin(2 * np.pi * fn * t))
    smooth = signal.lfilter(*signal.butter(2, 50, fs=FS), force)
    current = IDLE_CURRENT + 0.04 * smooth + rng.normal(0, 0.05, len(t))
    return current, vib, rpm, feed


def features(current, vib, rpm, feed):
    """8 features a person can interpret."""
    f, P = signal.periodogram(vib, FS)
    tot = P.sum() + 1e-12
    band = lambda lo, hi: P[(f >= lo) & (f < hi)].sum()
    f_rev, f_tp = rpm / 60, 2 * rpm / 60
    near = lambda fc: band(fc - 15, fc + 15)
    half = len(current) // 2                                           # skip filter start-up
    return np.array([feed, (current[half:].mean() - IDLE_CURRENT) / feed, current[half:].std(), np.sqrt(np.mean(vib ** 2)),
                     stats.kurtosis(vib), band(1100, 1900) / tot, near(f_tp) / tot,
                     near(f_rev) / (near(f_tp) + 1e-12)])


def dataset(n_per_class, seed):
    rng = np.random.default_rng(seed)
    X, y = [], []
    for c in range(4):
        for _ in range(n_per_class):
            X.append(features(*make_window(c, rng))); y.append(c)
    return np.array(X), np.array(y)


class Rules:
    """Hand-written thresholds, the 'no machine learning' baseline."""

    def predict(self, X):
        out = np.zeros(len(X), int)
        out[X[:, 1] > 1.65] = 1                # high cutting current per unit feed -> worn
        out[X[:, 5] > 0.5] = 2                 # vibration energy at resonance -> chatter
        out[X[:, 7] > 0.5] = 3                 # strong once-per-rev pulse -> broken tooth
        return out


def job_demo(model):
    """A 120 s job in one material: the tool wears steadily, the start speed is in a chatter
    zone, and a tooth breaks at 100 s. The monitor reacts once per second."""
    rng = np.random.default_rng(5)
    rpm, feed, stopped, log = 12000.0, 1.0, False, []
    chatter_zone = (11000, 13000)
    for s in range(120):
        wear = s / 120 * 0.9
        if stopped:
            log.append((s, rpm, feed, wear, -1, -1, "stopped")); continue
        state = 3 if s >= 100 else 2 if chatter_zone[0] < rpm < chatter_zone[1] and feed > 0.7 else 1 if wear > WORN else 0
        x = features(*make_window(state, rng, rpm, feed, wear, material=1.2))
        pred = int(model.predict(x[None])[0])
        used = (rpm, feed)                                      # settings during this window
        action = "-"
        if pred == 2:
            rpm *= 1.15; action = "chatter: spindle speed +15%"
        elif pred == 1 and feed > 0.8:
            feed *= 0.8; action = "worn: feed -20%, tool change flagged"
        elif pred == 3:
            stopped = True; action = "broken tooth: feed hold, spindle stop"
        log.append((s, *used, wear, state, pred, action))
    return log


def main():
    Xtr, ytr = dataset(300, seed=1)
    Xte, yte = dataset(100, seed=2)
    models = {"Hand-written rules": Rules(),
              "Decision tree (depth 4)": DecisionTreeClassifier(max_depth=4, random_state=0).fit(Xtr, ytr),
              "Random forest (100 trees)": RandomForestClassifier(100, random_state=0).fit(Xtr, ytr)}
    res, cms = {}, {}
    for n, m in models.items():
        p = m.predict(Xte)
        res[n] = float(accuracy_score(yte, p)); cms[n] = confusion_matrix(yte, p, labels=range(4))
        print(f"{n:27s} test accuracy {100 * res[n]:5.1f}%")
    rf = models["Random forest (100 trees)"]
    imp = rf.feature_importances_
    log = job_demo(rf)
    actions = [(s, a) for s, _, _, _, _, _, a in log if a not in ("-", "stopped")]
    correct = np.mean([st == pr for _, _, _, _, st, pr, _ in log if st >= 0])
    wrong = [(s_, round(w, 2), CLASSES[st], CLASSES[pr]) for s_, _, _, w, st, pr, _ in log if st >= 0 and st != pr]
    print("job demo disagreements (time, wear, true, predicted):", wrong)
    print(f"job demo: per-second accuracy {100 * correct:.0f}%; actions: {actions}")

    # Figure 1: signals, confusion matrix, importance, job timeline
    rng = np.random.default_rng(3)
    fig = plt.figure(figsize=(16, 8.5))
    gs = fig.add_gridspec(2, 3)
    ax = fig.add_subplot(gs[0, 0])
    for c, col in zip(range(4), ("C2", "C1", "C3", "C4")):
        _, vib, _, _ = make_window(c, rng, rpm=12000, feed=1.0, wear=0.8 if c == 1 else 0.1)
        ax.plot(np.arange(300) / FS * 1000, vib[:300] + 12 * (3 - c), col, lw=.7)
        ax.text(31, 12 * (3 - c), CLASSES[c], fontsize=8, va="center")
    ax.set(xlabel="time (ms)", yticks=[], title="Vibration signals (offset for clarity)", xlim=(0, 38))
    ax = fig.add_subplot(gs[0, 1])
    cm = cms["Random forest (100 trees)"]
    ax.imshow(cm, cmap="Blues")
    for i in range(4):
        for j in range(4):
            ax.text(j, i, cm[i, j], ha="center", va="center", color="w" if cm[i, j] > 50 else "k")
    ax.set_xticks(range(4), CLASSES, fontsize=8); ax.set_yticks(range(4), CLASSES, fontsize=8)
    ax.set(xlabel="predicted", ylabel="true", title=f"Random forest, 400 unseen windows ({100 * res['Random forest (100 trees)']:.1f}%)")
    ax = fig.add_subplot(gs[0, 2])
    o = np.argsort(imp)
    ax.barh(np.array(FEATURES)[o], imp[o], color="C0")
    ax.set(xlabel="importance", title="Which features the forest uses")
    ax = fig.add_subplot(gs[1, :])
    L = np.array([(s, st, pr) for s, _, _, _, st, pr, _ in log])
    ax.step(L[:, 0], L[:, 1], where="post", color="k", lw=2, label="true state")
    ax.plot(L[:, 0], L[:, 2], "o", ms=4, color="C1", label="monitor's prediction")
    ax2 = ax.twinx()
    ax2.plot([r[0] for r in log], [r[1] / 12000 for r in log], "C2--", label="spindle speed / 12000 rpm")
    ax2.plot([r[0] for r in log], [r[2] for r in log], "C0--", label="feed factor")
    ax2.set_ylim(0, 1.6); ax2.set_ylabel("speed and feed (relative)")
    for s, a in actions:
        ax.annotate(a, (s, 3.3), fontsize=8, rotation=0, ha="left", va="bottom", color="C3")
        ax.axvline(s, color="C3", lw=.6, ls=":")
    ax.set(yticks=[-1, 0, 1, 2, 3], yticklabels=["stopped"] + CLASSES, ylim=(-1.5, 4), xlabel="job time (s)",
           title="Adaptive machining: the monitor detects problems and the controller reacts")
    ax.legend(loc="lower left", fontsize=8); ax2.legend(loc="lower right", fontsize=8)
    fig.tight_layout()
    fig.savefig("results/tool_monitor.png", dpi=150, bbox_inches="tight")

    fig, ax = plt.subplots(figsize=(12, 5.5))
    plot_tree(models["Decision tree (depth 4)"], feature_names=FEATURES, class_names=CLASSES, filled=True,
              impurity=False, fontsize=10, ax=ax, proportion=False, max_depth=2)
    ax.set_title(f"Decision tree (first 2 levels) - test accuracy {100 * res['Decision tree (depth 4)']:.1f}%")
    fig.savefig("results/tool_tree.png", dpi=130, bbox_inches="tight")

    out = dict(accuracy=res, confusion_rf=cms["Random forest (100 trees)"].tolist(),
               confusion_rules=cms["Hand-written rules"].tolist(),
               importance=dict(zip(FEATURES, imp.round(3).tolist())), job_accuracy=float(correct),
               job_actions=actions, job_disagreements=wrong)
    json.dump(out, open("results/tool_monitor.json", "w"), indent=1)
    return out


if __name__ == "__main__":
    main()
