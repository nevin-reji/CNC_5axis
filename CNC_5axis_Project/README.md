# Intelligent 5-Axis CNC Machine

A table-tilting 5-axis CNC milling machine (X, Y, Z + A tilt + C spin) with four intelligent parts:

1. **5-axis kinematics and motion planning**: keeps the tool perpendicular to a curved part, avoids collisions, and slows down at the singularity.
2. **Servo control of every axis**: PID + feedforward, tuned by pole placement.
3. **Machine-learning tool monitoring**: spindle current and vibration tell a classifier whether the tool is fine, worn, chattering or broken, and the machine reacts.
4. **Finding the part**: the camera finds it roughly, then a touch probe measures it accurately.

All of it runs in simulation now. The G-code and the servo firmware are written so that a real machine can be built later (see `docs/HARDWARE.md`).

New to the topic? Read **`docs/LEARN.md`** first. It explains every idea in plain words and has viva questions with answers.

## Run it
```
pip install -r requirements.txt
python3 run_all.py              # every result in results/, about 40 s
open sim/cnc_sim.html           # 3D simulator in the browser (needs internet for three.js)
```

## Results (from `python3 run_all.py`)
| Part | Test | Result |
|---|---|---|
| Kinematics | 1000 random tool poses: inverse then forward | max error 1.4e-14 mm |
| Toolpath | Dome spiral, 2882 points, tool normal to surface | A 0-60 deg, no limit violations, holder clearance >= 8.6 mm |
| Collision check | Tool tilted 80 deg at the dome's foot | -4.5 mm: collision found |
| Feed planning | Constant 20 mm/s feed vs limit-aware planning | constant feed needs 1100% of an axis's speed limit; planned version stays within every limit, 80.1 s instead of 77.5 s |
| G-code | Write G93 program, read it back, forward kinematics | max tool-point error 0.001 mm |
| Axis control | RMS contour error on the part (25 Hz tuning) | P 399 um, PID 24 um, PID+FF 21 um (max 668 / 302 / 73 um) |
| Axis control | Z axis 1 mm step against gravity | P sags 398 um; PID 0.7 um; PID+FF 0.3 um with 1.3 um overshoot |
| Axis control | Bandwidth sweep (PID+FF) | RMS contour 1344 um at 5 Hz -> 3.8 um at 50 Hz |
| Tool monitor | 400 unseen windows, unknown material | rules 84%, decision tree 97%, random forest 98.8% |
| Tool monitor | 120 s job with chatter, wear, broken tooth | 99% of seconds correct; speed +15% at 0 s, feed -20% at 54 s, stop at 100 s |
| Part finding | 300 random placements (up to 6 mm, 4 deg off) | nominal 6.3 mm error; vision 0.40 mm; blind probe finds the part only 17% of the time; vision + probe 0.003 mm, 100% |

## Files
    kinematics.py          forward / inverse kinematics, joint limits (start here)
    toolpath.py            CAM: dome spiral, collision check, G-code writer and reader
    motion_planner.py      feed planning with joint speed/accel limits, figures, G-code, simulator data
    axis_control.py        servo model + P / PID / PID+feedforward, pole placement, bandwidth sweep
    tool_monitor.py        signal simulation, features, rules vs decision tree vs random forest, adaptive job
    probing.py             camera localisation (Otsu, moments) + touch probe least squares
    draw_architecture.py   system diagram
    draw_diagrams.py       machine-axes, control-loop and ML-pipeline diagrams for the report
    run_all.py             runs everything
    sim/cnc_sim.html       interactive 3D simulator (sim/toolpath.js is generated)
    firmware/axis_servo_pid/axis_servo_pid.ino   one servo axis for real hardware (STEP/DIR in, encoder, PID)
    results/               figures, JSON metrics, dome_finish.ngc (G-code), run_all.log
    docs/LEARN.md          plain-language guide + viva questions
    docs/HARDWARE.md       parts list, controller options, wiring, bring-up steps
    report/                builds IA3_REPORT_CNC.docx / .pdf from the template

## Assumptions and limits
- The A and C axes meet at the table centre (real trunnions have offsets; LinuxCNC's `xyzac-trt-kins` handles them).
- Signals, images and machine dynamics are simulated from simple physical models, not measured; a real build must re-tune gains and retrain the classifier on recorded data.
- The ball-end tool is kept exactly normal to the surface (real finishing usually adds a small lead angle).
- The servo firmware is syntax-checked but has not run on hardware.
