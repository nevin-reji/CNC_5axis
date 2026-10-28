# Building the real machine (later)

The simulation was written so that the same pieces carry over to hardware.

## 1. Mechanics (desktop size)
| Part | Suggestion | Notes |
|---|---|---|
| X, Y, Z slides | linear rails + 1605 ball screws, about 300 x 300 x 240 mm travel | matches `LIMITS` in `kinematics.py` |
| A trunnion | worm gear or harmonic drive, -30 to +110 deg | worm or harmonic drive keeps backlash low |
| C rotary table | 100-150 mm table on a worm or harmonic drive, continuous | |
| Spindle | 500 W - 1.5 kW ER11/ER16 spindle with VFD | the VFD gives the spindle current signal |
| Motors | closed-loop steppers, or DC/BLDC servos with encoders | the DC servo option uses `firmware/axis_servo_pid` |
| Touch probe | 3D touch probe (NC contact) | wired to the controller's probe input |
| Camera | USB camera above the table, calibrated once with a checkerboard | for coarse part finding |
| Accelerometer | ADXL345 / MPU-6050 on the spindle mount, or an analog piezo sensor for higher frequencies | chatter is around 1-2 kHz, so sample at 5 kHz or more |
| Current sensor | ACS712 / Hall sensor on the spindle supply, or the VFD's current output | |

## 2. Controller options
- **LinuxCNC (recommended).** It has a ready table-rotary-tilting kinematics module, `xyzac-trt-kins`, which is exactly this machine and adds proper tool-centre-point control with real pivot offsets. With trivial kinematics, the G-code from `toolpath.py` (joint coordinates, G93) runs directly.
- **grblHAL** on a Teensy 4.1 or an STM32 board supports 5 axes with step/dir outputs. Use joint-space G-code from `toolpath.py`.

## 3. One servo axis (`firmware/axis_servo_pid/axis_servo_pid.ino`)
For DC motors with encoders, one Arduino Uno per axis acts as a servo drive. It accepts STEP/DIR from the controller like a stepper driver would.

| Arduino pin | Connects to |
|---|---|
| D2, D3 | encoder A, B |
| D8 | STEP from the CNC controller |
| D4 | DIR from the CNC controller |
| D9 | H-bridge PWM |
| D7 | H-bridge direction |
| D6 | H-bridge enable |
| D13 | fault LED |
| GND | common with the controller and the H-bridge |

## 4. Bring-up steps
1. Lift the axis off the load, or remove the belt, and check the encoder: turning by hand must count up in the + direction.
2. Set `KI = KD = 0` and a small `KP`. Send `s` on the Serial Monitor at 115200 baud: the axis should step 1000 counts.
3. Raise `KP` until the step is quick with a little overshoot. Add `KD` to remove the overshoot, then `KI` to remove the final error. This is the same trade-off as the bandwidth sweep in `results/axis_control.png`.
4. Optional: measure the speed per PWM, set `KV` (velocity feedforward) = 1 / that value.
5. Set `MAX_FOLLOW` so a jam trips the fault quickly.
6. Home all axes, set soft limits as in `kinematics.LIMITS`, probe the part, then air-cut the program 20 mm above the part before cutting.

## 5. Safety
- Use an emergency stop that cuts motor power in hardware, not only in software.
- Fit an enclosure and wear eye protection; never reach in while the spindle runs.
- Run the first programs with feed override at 10-25%.
