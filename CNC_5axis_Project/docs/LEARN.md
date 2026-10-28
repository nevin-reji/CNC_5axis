# Learn the project in one hour

Each section is one idea: what it is, why it matters, where it is in the code, and what to say about it.

---

## 1. What is a 5-axis CNC machine?
A CNC mill cuts metal with a spinning tool that a computer moves. A 3-axis machine moves the tool in **X, Y, Z** only, so the tool always points straight down. A **5-axis** machine adds two **rotary axes** so the tool can meet the part from any side.

Our machine is the **table-tilting** type (also called trunnion type):
- the spindle moves in X, Y, Z and always points down;
- the table **tilts** about the X axis (the **A axis**);
- the table **spins** about its own centre (the **C axis**).

**Why bother?** On a curved part, a 3-axis machine can only cut with the side or the tip of a ball-end tool at changing angles, which leaves a poor finish. With 5 axes the tool stays perpendicular to the surface everywhere. Steep walls and undercuts can be reached in one clamping.

## 2. Kinematics (`kinematics.py`)
- **Forward kinematics:** given the joints (X, Y, Z, A, C), where is the tool on the part and which way does it point?
- **Inverse kinematics:** given where the tool must be on the part (point **p**) and which way it must point (unit vector **u**), what are the joints?

How it works: the table rotation is `R = Rx(A) · Rz(C)`, meaning first spin with C, then tilt with A. A point on the part ends up at `R·p` in the machine. The tool points along machine Z, so in part coordinates its direction is `Rᵀ·(0,0,1) = (sinA sinC, sinA cosC, cosA)`.

Solving the inverse gives `A = acos(u_z)` and `C = atan2(u_x, u_y)`. The linear axes are then `(X, Y, Z) = R·p`.

Three things to remember:
1. **Two solutions.** (A, C) and (−A, C+180°) give the same tool direction. We pick the one inside the A limits that is closest to the previous pose, so the table never makes a needless half-turn.
2. **The singularity.** When A = 0 the tool is vertical and C can be anything. Near it, a tiny move on the part needs a huge C rotation.
3. **Tool-centre-point control.** Because the part is not on the rotation centre, X and Y must move whenever the table turns, to keep the tool on the same spot. `R·p` does exactly that.

**Check:** inverse followed by forward gives back the same pose to 1e-14 mm for 1000 random poses.

## 3. Toolpath and collision check (`toolpath.py`)
- The part is a dome. The **spiral toolpath** starts at the top and winds outwards in 12 turns, with a point every 0.5 mm.
- At every point the tool axis is the **surface normal**. The programmed point is the **centre of the ball** on the tool: surface point + 3 mm × normal.
- **Collision check:** 16 points on the rim of the tool holder must stay above the part and the table. Our path keeps at least 8.6 mm clearance. A tool tilted 80° near the foot of the dome would hit it by 4.5 mm, and the check catches that.

## 4. Feed planning (`motion_planner.py`)
The program asks for a constant cutting feed of 20 mm/s, but each axis has a top speed and acceleration.

1. Time per move from the feed: `t = distance / feed`.
2. **Speed limit:** `t ≥ |joint change| / joint top speed` for every joint.
3. **Acceleration limit:** if a joint's speed changes too fast between two moves, stretch both moves by √(ratio). Acceleration scales with 1/t², so stretching by √ratio fixes it exactly. Repeat until nothing is over the limit.

**Result:** at constant feed one axis would need **11× its top speed** near the singularity. The planner slows only there, and the whole program takes 80.1 s instead of 77.5 s.

**G-code:** we write **G93 inverse-time feed**, where `F = 1 / (minutes for this move)`. This is the standard way to give a feed to moves that mix mm and degrees. Reading the file back and running forward kinematics reproduces the path to 0.001 mm.

## 5. Axis control (`axis_control.py`)
Each axis is a motor pushing a mass: `m·x'' = u − b·x' − friction − load`.
- The **load** is gravity on Z and on the unbalanced A trunnion, and the cutting force on X/Y.
- The **encoder** measures position in 1 µm (or 0.001°) steps.
- The loop runs at **1 kHz**.

| Controller | Idea | What happens |
|---|---|---|
| P | push proportional to the error | needs an error to push at all, so Z sags 0.4 mm under gravity |
| PID | + integral (removes steady error), + derivative (damping) | sag gone; contour error 24 µm |
| PID + feedforward | + the force a perfect model says is needed (m·a + b·v + friction + weight) | PID only fixes what is left; smallest error, 1.3 µm step overshoot |

**Pole placement** gives the gains from one number, the bandwidth ωn:
- `Kp = m·ωn²`
- `Kd = 2·ζ·ωn·m − b` (with ζ = 0.8)
- `Ki = Kp·ωn/10`

A higher ωn means a stiffer axis and less error: 1344 µm at 5 Hz, 3.8 µm at 50 Hz. Too high and the motor saturates and encoder noise is amplified: the maximum error rises again at 80 Hz.

**Contour error** is how far the tool is from the intended surface. It is what you would see on the part.

## 6. ML tool monitoring (`tool_monitor.py`)
**Sensors:**
- spindle motor current, which rises with cutting force;
- an accelerometer on the spindle, which measures vibration.

**The four states:**

| State | What happens physically | Signature |
|---|---|---|
| Normal | smooth cutting pulses | – |
| Worn | blunt edge: more force, rubbing noise | more current per unit feed, higher vibration RMS |
| Chatter | self-excited vibration at the machine's resonance (~1.5 kHz) | huge vibration energy in the 1.1–1.9 kHz band |
| Broken tooth | one of two teeth missing | strong once-per-revolution pulse instead of twice-per-revolution |

**8 features per 0.1 s window:**
1. feed
2. cutting current / feed
3. current ripple
4. vibration RMS
5. kurtosis (how spiky the signal is)
6. chatter-band share
7. tooth-pass share
8. once-per-rev / tooth-pass ratio

**Models compared:**
- **hand-written rules (84%):** fail because the workpiece material changes the current, and the material is unknown;
- **decision tree (97%):** readable as if-then rules (see `results/tool_tree.png`);
- **random forest (98.8%):** 100 trees vote.

The most important feature is vibration RMS.

**Adaptive machining:**
- chatter → spindle speed +15%, which moves away from the unstable speed;
- worn → feed −20% and flag a tool change;
- broken → feed hold and stop.

## 7. Finding the part (`probing.py`)
- **Vision (coarse):**
  - **Otsu threshold**, which picks the brightness that best splits dark from bright pixels;
  - **opening**, which removes small chips;
  - the biggest blob is the part;
  - its **centroid** gives the position, and the **principal axis** of its second moments gives the angle.
  - Accuracy is about 0.4 mm, limited by pixel size and camera calibration.
- **Touch probe (fine):**
  - three touches on the long edge are fitted with a **least-squares line**, which gives the angle;
  - two touches on the short edge fix the corner;
  - accuracy is about 3 µm.
- **Why both:**
  - the probe only searches 6 mm, so without the camera it found the part in just 17% of random placements;
  - with the camera telling it where to start: 100% success and 0.003 mm error.

---

## Viva questions and answers
**Q: Why a table-tilting machine and not a head-tilting one?**
It is simpler and stiffer for small parts, the spindle stays vertical, and it is the common design for desktop 5-axis machines. The price is that the part moves, so the linear axes must compensate (tool-centre-point control).

**Q: What is a kinematic singularity here?**
A = 0. The tool direction no longer depends on C, so C is undefined and small part motions need very fast C rotations. We keep the previous C and the feed planner slows the motion.

**Q: Why are there two inverse kinematics solutions?**
(A, C) and (−A, C+180°) point the tool the same way. We choose by joint limits and by closeness to the previous pose.

**Q: Why G93 inverse-time feed?**
A feed in mm/min means nothing for a degree-only move. Inverse time says how long each move should take, which is exactly what our planner computes.

**Q: Why does the P controller sag on Z?**
To hold the 4 kg axis against gravity it needs a force, and a P controller only gives force when there is an error. The integral term builds that force up, and feedforward supplies it directly.

**Q: How did you tune the PID?**
Pole placement. Choose the bandwidth ωn and damping ζ, then compute Kp, Ki and Kd from the axis mass and damping. The bandwidth sweep shows the trade-off.

**Q: What is feedforward?**
The force the model predicts the motor needs to follow the planned motion (mass × acceleration + damping × velocity + friction + weight). It acts before any error appears.

**Q: What is contour error and why does it matter more than following error?**
Following error is the lag of one axis along the path. Contour error is the tool's distance from the intended surface. Only the second spoils the part.

**Q: Why did the hand-written rules fail?**
Harder material raises the current just as a worn tool does. The learned models combine current with vibration features that respond to wear but not to material.

**Q: Why a random forest and also a decision tree?**
The forest is the most accurate. The tree is almost as good and can be read and explained line by line, which matters for a machine operator.

**Q: Why not just probe without the camera?**
The probe searches only a few millimetres. If the part is further off, it misses. The camera gives a starting point good to 0.4 mm.

**Q: What is Otsu's method?**
It tries every threshold and picks the one that maximises the variance between the two pixel groups, which is the same as minimising the variance inside each group.

**Q: Is any of this tested on real hardware?**
No. Everything is a simulation with simple physical models. The G-code follows LinuxCNC conventions and the servo firmware is written for a real Arduino axis, but both need testing and re-tuning on a real machine.

**Q: What would you add next?**
- a real build with LinuxCNC `xyzac-trt-kins`;
- training the classifier on recorded sensor data;
- a lead/tilt angle for the ball-end tool;
- a full 3D collision check with machine models;
- a ROS 2 / Gazebo digital twin.
