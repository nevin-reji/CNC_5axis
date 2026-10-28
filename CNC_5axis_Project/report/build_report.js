// Builds IA3_REPORT_CNC.docx in the layout of the IA3 skill-based evaluation template
// (cover, title page, abstract, problem statement, methodology, implementation,
// conclusion, evaluation sheet). Equations are real Word equations (OMML), written
// here in a small LaTeX-like notation. Code listings are read from the source files
// and numbers from results/*.json, so the report always matches the code that ran.
// Run: cd report && node build_report.js
const fs = require('fs');
const path = require('path');
const {
  Document, Packer, Paragraph, TextRun, AlignmentType, ImageRun, Table, TableRow, TableCell,
  WidthType, ShadingType, BorderStyle, LevelFormat, PageBreak, Footer, PageNumber, VerticalAlign,
  TabStopType, Math: OMath, MathRun, MathFraction, MathSubScript, MathSuperScript, MathSubSuperScript,
  MathRadical, MathSum, MathIntegral, MathFunction, MathRoundBrackets, MathSquareBrackets, MathCurlyBrackets,
  MathLimitLower,
} = require('docx');

const ROOT = path.resolve(__dirname, '..') + '/';
const read = (f) => fs.readFileSync(ROOT + f);
const json = (f) => JSON.parse(fs.readFileSync(ROOT + 'results/' + f, 'utf8'));
const TNR = 'Times New Roman';
const STUDENT = '[STUDENT NAME]', REGNO = '[REG. NO]';
const TITLE = 'Intelligent 5-Axis CNC Machine with Tool-Centre-Point Kinematics, PID Servo Control, Machine-Learning Tool Monitoring and Vision-Guided Probing';

const kn = json('kinematics.json'), pl = json('planning.json'), ac = json('axis_control.json');
const tm = json('tool_monitor.json'), pr = json('probing.json');
const pct = (v) => `${(100 * v).toFixed(Math.abs(100 * v - Math.round(100 * v)) < 0.05 ? 0 : 1)}%`;
const f1 = (v) => Number(v).toFixed(1), f2 = (v) => Number(v).toFixed(2), f3 = (v) => Number(v).toFixed(3);

// ---------- equations: a small LaTeX-like notation -> Word (OMML) math ----------
//   x_{i}  x^{2}  x_{i}^{2}  \frac{a}{b}  \sqrt{a}  \sum_{a}^{b}{body}  \int{body}
//   \fn{sin}{x} (upright function name)  \p{..} ( )  \sq{..} [ ]  \cb{..} { }
//   \lim{max}{i}{body}  (operator with a limit underneath, e.g. max over i)
function parseMath(src) {
  let i = 0;
  const group = () => {
    if (src[i] !== '{') throw new Error(`expected { at ${i} in ${src}`);
    i += 1;
    const out = seq('}');
    i += 1;
    return out;
  };
  function seq(end) {
    const items = [];
    let buf = '';
    const flush = () => { if (buf) { items.push(new MathRun(buf)); buf = ''; } };
    while (i < src.length && src[i] !== end) {
      const ch = src[i];
      if (ch === '\\') {
        flush();
        const m = /^\\([a-zA-Z]+)/.exec(src.slice(i));
        i += m[0].length;
        const cmd = m[1];
        if (cmd === 'frac') { const n = group(); const d = group(); items.push(new MathFraction({ numerator: n, denominator: d })); }
        else if (cmd === 'sqrt') items.push(new MathRadical({ children: group() }));
        else if (cmd === 'fn') { const n = group(); const a = group(); items.push(new MathFunction({ name: n, children: a })); }
        else if (cmd === 'p') items.push(new MathRoundBrackets({ children: group() }));
        else if (cmd === 'sq') items.push(new MathSquareBrackets({ children: group() }));
        else if (cmd === 'cb') items.push(new MathCurlyBrackets({ children: group() }));
        else if (cmd === 'lim') {
          const n = group(); const l = group(); const a = group();
          items.push(new MathFunction({ name: [new MathLimitLower({ children: n, limit: l })], children: a }));
        } else if (cmd === 'sum' || cmd === 'int') {
          let s1, s2;
          if (src[i] === '_') { i += 1; s1 = group(); }
          if (src[i] === '^') { i += 1; s2 = group(); }
          const body = group();
          const K = cmd === 'sum' ? MathSum : MathIntegral;
          items.push(new K({ children: body, ...(s1 && { subScript: s1 }), ...(s2 && { superScript: s2 }) }));
        } else throw new Error(`unknown \\${cmd}`);
      } else if (ch === '{') {
        flush(); items.push(...group());
      } else if (ch === '_' || ch === '^') {
        let base;
        if (buf) { base = [new MathRun(buf.slice(-1))]; buf = buf.slice(0, -1); flush(); } else base = [items.pop()];
        i += 1;
        const first = group();
        if (ch === '_' && src[i] === '^') { i += 1; items.push(new MathSubSuperScript({ children: base, subScript: first, superScript: group() })); }
        else if (ch === '_') items.push(new MathSubScript({ children: base, subScript: first }));
        else items.push(new MathSuperScript({ children: base, superScript: first }));
      } else { buf += ch; i += 1; }
    }
    flush();
    return items;
  }
  return seq(undefined);
}
const math = (s) => new OMath({ children: parseMath(s) });
// Text with inline equations between $...$
const inline = (s, o = {}) => s.split('$').flatMap((part, k) => (k % 2 ? [math(part)]
  : part ? [new TextRun({ text: part, font: TNR, size: 24, ...o })] : []));
let eqNo = 0;
const eqRef = {};
function eqn(s, label) {                       // numbered display equation
  eqNo += 1;
  if (label) eqRef[label] = eqNo;
  return new Paragraph({
    tabStops: [{ type: TabStopType.CENTER, position: 4513 }, { type: TabStopType.RIGHT, position: 9026 }],
    spacing: { before: 100, after: 140 }, keepLines: true,
    children: [new TextRun('\t'), math(s), new TextRun({ text: `\t(${eqNo})`, font: TNR, size: 24 })],
  });
}

// ---------- text helpers ----------
const run = (t, o = {}) => new TextRun({ text: t, font: TNR, size: 24, ...o });
const kids = (content, o) => (Array.isArray(content) ? content : [content]).flatMap((c) => (typeof c === 'string' ? inline(c, o) : [c]));
const p = (content, o = {}) => new Paragraph({ alignment: AlignmentType.JUSTIFIED, spacing: { before: 80, after: 120, line: 360 }, ...o, children: kids(content) });
const b = (t) => run(t, { bold: true });
const center = (t, o = {}, po = {}) => new Paragraph({ alignment: AlignmentType.CENTER, ...po, children: [new TextRun({ text: t, ...o })] });
const heading = (t) => new Paragraph({ alignment: AlignmentType.CENTER, pageBreakBefore: true, spacing: { after: 360 }, children: [run(t, { bold: true, size: 28 })] });
const sub = (t) => new Paragraph({ spacing: { before: 240, after: 100 }, keepNext: true, children: [run(t, { bold: true })] });
const sub2 = (t) => new Paragraph({ spacing: { before: 160, after: 60 }, keepNext: true, children: [run(t, { bold: true, italics: true })] });
const listPara = (ref) => (content) => new Paragraph({ numbering: { reference: ref, level: 0 }, alignment: AlignmentType.JUSTIFIED,
  spacing: { after: 60, line: 320 }, children: kids(content) });
const bullet = listPara('bul');

let figNo = 0, tabNo = 0, lstNo = 0;
const figRef = {};
function fig(file, caption, widthPx = 600, label) {
  const buf = read(file);
  const w = buf.readUInt32BE(16), h = buf.readUInt32BE(20);
  figNo += 1;
  if (label) figRef[label] = figNo;
  return [
    new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 120, after: 40 }, keepNext: true,
      children: [new ImageRun({ type: 'png', data: buf, transformation: { width: widthPx, height: Math.round(widthPx * h / w) },
        altText: { title: caption, description: caption, name: path.basename(file) } })] }),
    new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 200 }, children: [run(`Figure ${figNo}: ${caption}`, { italics: true, size: 20 })] }),
  ];
}
const border = { style: BorderStyle.SINGLE, size: 4, color: '000000' };
const borders = { top: border, bottom: border, left: border, right: border };
function table(widths, header, rows, o = {}) {
  const font = o.font || TNR, size = o.size || 20;
  const cell = (t, w, hd, k, last) => new TableCell({
    borders, width: { size: w, type: WidthType.DXA }, verticalAlign: VerticalAlign.CENTER,
    shading: hd && !o.plainHeader ? { type: ShadingType.CLEAR, fill: 'D9D9D9' } : undefined,
    margins: { top: o.pad ?? 50, bottom: o.pad ?? 50, left: 90, right: 90 },
    children: [new Paragraph({ alignment: (o.centerCols || []).includes(k) ? AlignmentType.CENTER : AlignmentType.LEFT,
      keepNext: !last, keepLines: true, children: inline(String(t), { bold: hd || (o.boldBody && !hd), font, size }) })],
  });
  return new Table({
    width: { size: widths.reduce((a, c) => a + c, 0), type: WidthType.DXA }, columnWidths: widths, alignment: AlignmentType.CENTER,
    rows: [new TableRow({ tableHeader: true, cantSplit: true, children: header.map((t, k) => cell(t, widths[k], true, k, false)) }),
      ...rows.map((r, i) => new TableRow({ cantSplit: true, children: r.map((t, k) => cell(t, widths[k], false, k, i === rows.length - 1)) }))],
  });
}
const tcap = (t) => { tabNo += 1; return new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 200, after: 80 }, keepNext: true,
  children: [run(`Table ${tabNo}: ${t}`, { bold: true, size: 20 })] }); };
const gap = (after = 160) => new Paragraph({ spacing: { after }, children: [] });

// ---------- code listings ----------
const src = (f) => fs.readFileSync(ROOT + f, 'utf8').replace(/\r/g, '').split('\n');
function pyBlock(file, header) {
  const L = src(file);
  const i = L.findIndex((l) => l.startsWith(header));
  if (i < 0) throw new Error(`${header} not found in ${file}`);
  let j = i + 1;
  while (j < L.length && (L[j] === '' || /^\s/.test(L[j]))) j += 1;
  while (L[j - 1] === '') j -= 1;
  return L.slice(i, j);
}
const blocks = (file, ...headers) => headers.flatMap((h, k) => (k ? ['', ...pyBlock(file, h)] : pyBlock(file, h)));
function between(file, start, end) {
  const L = src(file);
  const i = L.findIndex((l) => l.startsWith(start)), j = L.findIndex((l, k) => k > i && l.startsWith(end));
  const out = L.slice(i, j);
  while (out[out.length - 1] === '') out.pop();
  return out;
}
function listing(caption, lines) {
  lstNo += 1;
  return [
    new Paragraph({ spacing: { before: 160, after: 60 }, keepNext: true, children: [run(`Listing ${lstNo}: ${caption}`, { bold: true, size: 20 })] }),
    ...lines.map((l, k) => new Paragraph({
      spacing: { after: 0, line: 228 }, keepLines: true, keepNext: lines.length < 25 && k < lines.length - 1,
      shading: { type: ShadingType.CLEAR, fill: 'F3F3F3' },
      border: k === 0 ? { top: { style: BorderStyle.SINGLE, size: 4, color: 'BBBBBB', space: 2 } }
        : k === lines.length - 1 ? { bottom: { style: BorderStyle.SINGLE, size: 4, color: 'BBBBBB', space: 2 } } : undefined,
      children: [new TextRun({ text: l.length ? l : ' ', font: 'Courier New', size: 15 })] })),
    gap(120),
  ];
}

// ---------- cover and title page (as in the template) ----------
const img = (f, w, h, name) => new ImageRun({ type: 'png', data: read('report/assets/' + f), transformation: { width: w, height: h }, altText: { title: name, description: name, name } });
const arialB = (t, size, before = 0) => center(t, { font: 'Arial', bold: true, size }, { spacing: { before, after: 0 } });
const bookman = (t, size, before = 0) => center(t, { font: 'Bookman Old Style', bold: true, size }, { spacing: { before, after: 0 } });
const cover = [
  new Paragraph({ alignment: AlignmentType.CENTER, children: [img('karunya_header.png', 600, 100, 'Karunya header')] }),
  arialB('A SKILL BASED EVALUATION REPORT', 34, 1000),
  arialB('SUBMITTED BY', 28, 900), arialB(`${STUDENT} (${REGNO})`, 28, 120),
  arialB('COURSE CODE', 28, 900), arialB('24AI2003', 28, 60),
  arialB('COURSE NAME', 28, 900), arialB('INTELLIGENT ROBOTICS', 28, 360), arialB('OCTOBER 2026', 28, 400),
  new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 300 }, children: [img('karunya_logo.png', 100, 104, 'Karunya logo')] }),
  bookman('DIVISION OF ARTIFICIAL INTELLIGENCE AND MACHINE LEARNING', 28, 700),
  bookman('SCHOOL OF COMPUTER SCIENCE AND TECHNOLOGY', 24, 40),
  new Paragraph({ children: [new PageBreak()] }),
  new Paragraph({ children: [new PageBreak()] }),
];
const titlePage = [
  new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 200, line: 360 }, children: [run(TITLE.toUpperCase(), { bold: true, size: 36 })] }),
  new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 1300 }, children: [run('Submitted by', { bold: true, italics: true, size: 28 })] }),
  new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 200 }, children: [run(`${STUDENT} (${REGNO})`, { bold: true, size: 32 })] }),
  new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 1500 }, children: [img('karunya_logo_small.png', 125, 118, 'Karunya logo')] }),
  bookman('DIVISION OF ARTIFICIAL INTELLIGENCE AND MACHINE LEARNING', 28, 900),
  center('KARUNYA INSTITUTE OF TECHNOLOGY AND SCIENCES', { font: TNR, bold: true, size: 28 }, { spacing: { before: 1200 } }),
  center('(Declared as Deemed-to-be-under Sec-3 of the UGC Act,', { font: TNR, bold: true, size: 32 }),
  center('1956) Karunya Nagar, Coimbatore - 641 114. INDIA', { font: TNR, bold: true, size: 32 }),
  center('OCTOBER 2026', { font: TNR, bold: true, size: 32 }, { spacing: { before: 500 } }),
];

// ---------- numbers ----------
const [c0, c1] = pl.cases;
const C = ac.controllers, zs = ac.z_step, sw = ac.bandwidth_sweep, G = ac.gains_25Hz;
const swAt = (w) => sw.find((s) => s.wn_hz === w);
const acc = tm.accuracy;
const accR = acc['Hand-written rules'], accT = acc['Decision tree (depth 4)'], accF = acc['Random forest (100 trees)'];
const M = pr.methods;
const nom = M['No measurement (assume nominal)'], vis = M['Vision only'], blind = M['Probe only (blind start)'], vp = M['Vision + probe'];
const imp = Object.entries(tm.importance).sort((a, b2) => b2[1] - a[1]);
const CLS = ['Normal', 'Worn', 'Chatter', 'Broken tooth'];
const prf = (cm, k) => {
  const tp = cm[k][k], col = cm.reduce((s, r) => s + r[k], 0), row = cm[k].reduce((s, v) => s + v, 0);
  const P = col ? tp / col : 0, R = tp / row;
  return [P, R, P + R ? 2 * P * R / (P + R) : 0];
};
const big = (v) => Math.round(v).toLocaleString('en-US');

// ---------- abstract ----------
const abstract = [
  heading('ABSTRACT'),
  p('A five-axis CNC machine can keep its cutting tool perpendicular to a curved surface, which gives a better surface finish and reaches features that a three-axis machine cannot. Doing this well needs the main skills of intelligent robotics: kinematics, motion planning, feedback control, sensing, perception and machine learning. This project designs and simulates a table-tilting 5-axis milling machine (linear axes X, Y, Z; tilt axis A; rotary table C) and adds four intelligent subsystems, each compared with a simpler baseline.'),
  p(`(1) Kinematics and planning: closed-form forward and inverse kinematics with tool-centre-point compensation (round-trip error 1.4×10⁻¹⁴ mm), a spiral finishing path over a dome with the tool normal to the surface, a tool-holder collision check, and a feed-rate planner that respects every joint's speed and acceleration limits. At a constant feed, one axis would need ${f1(c0.max_speed_ratio)} times its top speed near the kinematic singularity; the planner removes this for a ${f1(100 * (c1.cycle_s / c0.cycle_s - 1))}% longer cycle. The program is written as G93 inverse-time G-code and verified by reading it back. (2) Servo control: each axis is modelled with mass, friction, gravity and cutting load, and controlled by PID with feedforward tuned by pole placement. The RMS contour error falls from ${f1(C.P.rms_contour_um)} µm (P) to ${f1(C['PID+FF'].rms_contour_um)} µm (PID + feedforward at 25 Hz), and to ${f1(swAt(50).rms_contour_um)} µm at 50 Hz bandwidth. (3) Tool monitoring: spindle current and vibration windows are turned into eight physical features; a random forest recognises normal, worn, chattering and broken-tooth states with ${f1(100 * accF)}% accuracy on unseen data with unknown work material, against ${f1(100 * accR)}% for hand-written rules, and drives adaptive speed and feed changes. (4) Part localisation: a camera with Otsu thresholding and image moments finds the part to ${f3(vis.mean_err_mm)} mm, and a touch probe with least-squares fitting refines this to ${f3(vp.mean_err_mm)} mm; without the camera the probe found the part in only ${pct(blind.success)} of placements.`),
  p('An interactive 3D simulator shows the machine running the program, and servo firmware and a hardware guide prepare a later physical build. All results are produced by one script, so every number in this report can be regenerated.'),
  p([b('Keywords: '), run('5-axis CNC, inverse kinematics, singularity, feed-rate planning, G-code, PID, feedforward, pole placement, tool condition monitoring, random forest, decision tree, computer vision, touch probing, least squares.')]),
];

// ---------- problem statement ----------
const pp = (c) => p(c, { spacing: { before: 60, after: 100, line: 320 } });
const problem = [
  heading('PROBLEM STATEMENT'),
  pp('Curved parts such as moulds, turbine blades, impellers and medical implants are finished best with the tool held perpendicular to the surface. A three-axis machine cannot do this: its tool always points straight down, so on a curved surface a ball-end tool cuts with a different part of the ball at every point, and steep walls are reached poorly or not at all. A five-axis machine solves this by adding two rotary axes, but the two extra axes bring problems of their own:'),
  bullet([b('Kinematics. '), run('The CAM program describes the tool on the part, while the machine moves joints. Each tool direction has two joint solutions, and at one orientation (the singularity) the rotary table would have to spin very fast for a tiny move on the part.')]),
  bullet([b('Motion feasibility and safety. '), run('A constant cutting feed can demand joint speeds and accelerations the motors cannot produce, and a tilted tool holder can collide with the part or the table.')]),
  bullet([b('Accuracy. '), run('Gravity, friction and cutting forces push the axes off the path, and every micrometre of contour error shows on the finished surface.')]),
  bullet([b('Process state. '), run('Tool wear, chatter and broken teeth ruin parts and tools, but are hard to see while the machine is cutting.')]),
  bullet([b('Part location. '), run('A part clamped by hand is never exactly where the program expects it; a few millimetres of error makes the part scrap.')]),
  pp([b('Problem. '), run('Design, implement and evaluate an intelligent 5-axis CNC system that (a) converts a tool path into safe, feasible joint motion; (b) follows it accurately with well-tuned servo control; (c) monitors the cutting process with machine learning and reacts to problems; and (d) locates the workpiece automatically with vision and probing. Every method should be explainable step by step, and the design should be ready for a later hardware build.')]),
  sub('Objectives'),
  ...['Derive and verify forward and inverse kinematics of a table-tilting A-C machine, including solution choice and singularity handling (kinematics).',
    'Generate a 5-axis finishing path, check holder collisions and joint limits, plan feed rates within joint speed and acceleration limits, and output verified G-code (motion planning).',
    'Model the five servo axes and compare P, PID and PID + feedforward control tuned by pole placement; find the best bandwidth (control, optimisation).',
    'Detect tool wear, chatter and broken teeth from spindle current and vibration with machine learning, compare it with fixed rules, and adapt the process (AI/ML, sensing).',
    'Locate the workpiece with a camera and a touch probe and measure the accuracy of each step (perception).',
    'Provide an interactive 3D simulator, servo firmware and a hardware guide (simulation, hardware readiness).'].map(listPara('obj')),
  sub('Why this is an intelligent robotics problem'),
  pp('A 5-axis machine tool is a serial robot with five joints, and the same questions arise as for a robot arm: how joint motion maps to the motion of the end effector (kinematics), how to move between poses smoothly and within the limits of the actuators (motion planning), how to make each joint follow its command despite disturbances (control), how to know where the work object is (perception), and how to recognise and respond to abnormal situations (machine learning and decision making). Working on a machine tool makes these questions concrete, because the result is measured in micrometres on the finished part.'),
  sub('Expected outcomes'),
  ...['Verified kinematics and a feasible, collision-free 5-axis program in standard G-code.',
    'A servo control design with a clear tuning rule and a measured accuracy improvement over P control.',
    'A tool monitor that is more reliable than fixed thresholds and acts on what it detects.',
    'A localisation method that finds a misplaced part reliably and accurately.',
    'Simulation tools, firmware and documentation that allow the work to be demonstrated and built.'].map(listPara('bul')),
  sub('Scope and assumptions'),
  pp('The machine is desktop size (300 × 300 × 240 mm travel). The A and C axes are assumed to intersect at the centre of the table top. The case study is the finishing of a dome with a 3 mm ball-end tool, plus the localisation of a rectangular block. Machine dynamics, sensor signals and camera images are simulated from simple physical models; the limitations of this are discussed in the Conclusion.'),
];

// ---------- methodology ----------
const methodology = [
  heading('METHODOLOGY / ARCHITECTURE'),
  sub('1. System architecture'),
  p('The system has three chains (Figure 1). The planning chain turns the part geometry into G-code: CAM path, inverse kinematics, collision and limit checks, feed planning. The control chain executes it: the CNC controller interpolates the moves at 1 kHz and five servo drives make the axes follow, using encoder feedback. Two sensing chains add intelligence: vision and probing locate the part before cutting (giving the work offset), and the machine-learning monitor watches the cut and overrides the feed and spindle speed.'),
  ...fig('results/architecture.png', 'System architecture of the intelligent 5-axis CNC'),
  sub('2. Machine design'),
  p('A table-tilting (trunnion) layout was chosen (Figure 2). The spindle moves in X, Y and Z and always points down along the machine Z axis. The table tilts about the X axis (A axis) and spins about its own axis (C axis), with C mounted on the A cradle. This layout is the most common for small 5-axis machines because the spindle stays rigid and vertical, and both rotary axes can use compact worm or harmonic drives. Its cost is that the part moves, so the linear axes must compensate whenever the table turns.'),
  ...fig('results/machine_axes.png', 'Machine axes: A tilts the table about X (left); C spins the table, and the part is clamped off-centre (right)'),
  tcap('Machine specification used in the simulation'),
  table([2100, 3300, 3626], ['Axis / part', 'Range and limits', 'Role'], [
    ['X, Y, Z slides', '±150, ±150, ±120 mm; 50 mm/s; 500 mm/s²', 'Move the spindle; the tool always points along machine Z'],
    ['A trunnion', '−30° … +110°; 90 °/s; 720 °/s²', 'Tilts the table about X'],
    ['C rotary table', 'continuous; 180 °/s; 1440 °/s²', 'Spins the part about the table axis'],
    ['Spindle + ball-end tool', 'R 3 mm ball, 25 mm stick-out, Ø 24 mm holder', 'Cuts; holder geometry is used for collision checks'],
    ['Encoders', '1 µm (linear), 0.001° (rotary)', 'Position feedback for the servo loops'],
    ['Process sensors', 'spindle current, accelerometer (10 kHz)', 'Inputs to the machine-learning tool monitor'],
    ['Localisation sensors', 'overhead camera (0.4 mm/pixel), touch probe (2 µm)', 'Find the part before cutting'],
  ]),
  sub('3. Software modules'),
  table([600, 2500, 5926], ['#', 'Module (file)', 'Function'], [
    ['M1', 'Kinematics (kinematics.py)', 'Forward/inverse kinematics, two-solution choice, singularity handling, joint limits'],
    ['M2', 'CAM (toolpath.py)', 'Dome spiral with tool normal to surface, holder collision check, G93 G-code writer and reader'],
    ['M3', 'Motion planner (motion_planner.py)', 'Feed planning under joint speed and acceleration limits; simulator data'],
    ['M4', 'Axis control (axis_control.py)', 'Servo model, interpolator, P / PID / PID + feedforward, pole placement, bandwidth sweep'],
    ['M5', 'Tool monitor (tool_monitor.py)', 'Current and vibration simulation, 8 features, rules vs decision tree vs random forest, adaptive job'],
    ['M6', 'Part finding (probing.py)', 'Otsu threshold, morphology, image moments; touch probe with least-squares edge fitting'],
    ['M7', 'Simulator and firmware', '3D browser simulator (sim/cnc_sim.html); one-axis servo firmware (STEP/DIR in, encoder, PID)'],
    ['M8', 'Experiments (run_all.py)', 'Runs every module and writes all figures, metrics (JSON) and the G-code'],
  ], { centerCols: [0] }),

  sub('4. Kinematics'),
  sub2('4.1 Forward kinematics'),
  p('Two coordinate frames are used: the machine frame (fixed to the machine base) and the part frame (fixed to the part, moving with the table). A point $p$ fixed on the part is carried first by the C table and then by the A cradle, so in machine coordinates it is at $R p$ with'),
  eqn('R\\p{A,C}=R_{x}\\p{A} R_{z}\\p{C}', 'R'),
  p('where $R_{x}\\p{A}$ is a rotation by A about the x axis and $R_{z}\\p{C}$ a rotation by C about the z axis. The tool tip is at the machine position $\\sq{X,Y,Z}^{T}$ and the tool points along machine z, $e_{z}=\\sq{0,0,1}^{T}$. Undoing the table rotation gives the tool tip and the tool direction on the part:'),
  eqn('p=R^{T}\\sq{X,Y,Z}^{T},          u=R^{T}e_{z}=\\p{\\fn{sin}{A} \\fn{sin}{C},  \\fn{sin}{A} \\fn{cos}{C},  \\fn{cos}{A}}^{T}', 'fk'),
  sub2('4.2 Inverse kinematics'),
  p(`The CAM program gives $p$ and $u$; the controller needs the joints. Equation (${eqRef.fk}) can be solved directly for the rotary axes:`),
  eqn('A=±\\fn{arccos}{u_{z}},          C=\\fn{atan2}{\\p{u_{x}, u_{y}}}', 'ik'),
  p('(with C increased by 180° for the negative-A solution), and the linear axes follow from the forward relation:'),
  eqn('\\sq{X,Y,Z}^{T}=R_{x}\\p{A} R_{z}\\p{C} p', 'xyz'),
  p(`Equation (${eqRef.xyz}) is what makes the machine keep the tool on the same spot of the part while the table turns: if the part is off-centre, X and Y must move. This is called tool-centre-point (TCP) control. Three practical points are handled in the code:`),
  bullet([b('Two solutions. '), ('$\\p{A,C}$ and $\\p{-A,C+180°}$ point the tool the same way. The solution inside the A limits and closest to the previous pose is kept, so the table never makes an unnecessary half-turn.')]),
  bullet([b('Unwrapping C. '), run('C is continuous, so each new C is shifted by a multiple of 360° to be nearest to the previous value.')]),
  bullet([b('Singularity. '), (`At $A=0$ the tool is vertical and $u$ does not depend on C (the factor $\\fn{sin}{A}$ in equation (${eqRef.fk}) is zero), so C is undefined and the previous C is kept. Near $A=0$, a small move on the part needs a large change of C, which the feed planner must slow down.`)]),
  tcap('Worked inverse-kinematics examples (from kinematics.py)'),
  table([2300, 2500, 4226], ['Tool tip $p$ (mm)', 'Tool direction $u$', 'Joints (X, Y, Z in mm; A, C in degrees)'],
    kn.examples.map((e) => [`(${e.p.join(', ')})`, `(${e.u.map((v) => f2(v)).join(', ')})`, `(${e.q.map((v) => f2(v)).join(', ')})`]), { centerCols: [0, 1, 2] }),
  p(`The first row is the singular case (tool vertical): A = 0 and C stays at its previous value. Verification: for 1000 random poses, running inverse and then forward kinematics returns the same tool pose to within ${kn.roundtrip_max_error.toExponential(1)} mm, which is the limit of floating-point arithmetic.`),

  sub('5. Toolpath and collision checking'),
  p('The part is a dome: a cap of a sphere of radius $R_{s}=40$ mm whose centre is 15 mm below the table, standing 25 mm high and clamped with its centre 22 mm from the table centre (offset $o=\\p{20, -10, 0}$ mm). A point on the dome at angle φ from its top and angle θ around it has the outward normal'),
  eqn('n=\\p{\\fn{sin}{φ} \\fn{cos}{θ},  \\fn{sin}{φ} \\fn{sin}{θ},  \\fn{cos}{φ}}^{T}', 'normal'),
  p('The spiral path increases φ from 0 to 60° while θ makes 12 full turns, $θ=24π φ/φ_{max}$, and φ is stepped so that consecutive points are about 0.5 mm apart on the surface. With a ball-end tool of radius $r=3$ mm, the programmed point is the centre of the ball and the tool axis is the surface normal:'),
  eqn('S=c+R_{s} n,          p=S+r n,          u=n', 'ball'),
  p('where $c$ is the sphere centre and $S$ the contact point. The result is 2882 points. For collision checking, the tool holder (radius 12 mm) starts 25 mm up the tool. Sixteen points $\\p{x_{k},y_{k},z_{k}}$ on the rim of its lower face are computed, and every one must lie above the part surface (or the table) underneath it:'),
  eqn('\\lim{min}{k}{\\p{z_{k}-h\\p{x_{k},y_{k}}}}>0', 'clear'),
  p('where $h\\p{x,y}$ is the height of the dome, or zero on the table. Joint limits are checked at every point as well.'),

  sub('6. Feed-rate planning'),
  p('The CAM program asks for a constant feed $F=20$ mm/s along the part. For the move from point k to point k+1, of length $d_{k}$ on the part and joint change $Δq_{i,k}$ for joint i, the planner first sets the time from the feed and then raises it so that no joint exceeds its top speed $v_{max,i}$:'),
  eqn('t_{k}=\\lim{max}{i}{\\p{\\frac{d_{k}}{F},  \\frac{|Δq_{i,k}|}{v_{max,i}}}}', 'tvel'),
  p('The joint velocities are then $v_{i,k}=Δq_{i,k}/t_{k}$. At each junction between two moves, the acceleration needed is'),
  eqn('a_{i,k}=\\frac{|v_{i,k+1}-v_{i,k}|}{\\p{t_{k}+t_{k+1}}/2}', 'acc'),
  p('If the worst ratio $ρ_{k}=\\lim{max}{i}{a_{i,k}/a_{max,i}}$ is above 1, both moves at that junction are stretched. Because acceleration scales with $1/t^{2}$, stretching by $\\sqrt{ρ_{k}}$ brings the junction exactly to the limit:'),
  eqn('t_{k} ← t_{k}\\sqrt{ρ_{k}}', 'stretch'),
  p('This is repeated until no junction exceeds its limit, with the machine starting and ending at rest. Finally the times are written as G-code in inverse-time feed mode (G93), the standard way to give a feed rate to moves that combine millimetres and degrees. F is the reciprocal of the move time in minutes, so with $t_{k}$ in seconds:'),
  eqn('F_{G93}=\\frac{60}{t_{k}}', 'g93'),
  p('The G-code file is then read back and passed through forward kinematics to check that it reproduces the intended path.'),

  sub('7. Servo control and tuning'),
  p('Each axis is a motor driving a mass m (or an inertia, for A and C) against viscous damping b, Coulomb friction $F_{c}$ and a load $F_{L}$: gravity on Z and on the unbalanced A cradle, and a varying 15 N cutting force on X and Y. The control loop is shown in Figure 3.'),
  eqn('m ẍ=u-b ẋ-F_{c} \\fn{sgn}{\\p{ẋ}}-F_{L}', 'plant'),
  ...fig('results/control_loop.png', 'Servo control loop of one axis: PID on the error plus model-based feedforward'),
  p('The interpolator joins the planned points with straight lines every 1 ms and smooths them with a 20 ms moving average, giving the reference position r, velocity $v_{ref}$ and acceleration $a_{ref}$. With the error $e=r-x_{meas}$ (the encoder position, quantised to 1 µm or 0.001°), the controller output is'),
  eqn('u=K_{p}e+K_{i}\\int{e dt}+K_{d}\\frac{de}{dt}+u_{ff}', 'pid'),
  eqn('u_{ff}=m a_{ref}+b v_{ref}+F_{c} \\fn{sgn}{\\p{v_{ref}}}+m g', 'ff'),
  p('The feedforward term $u_{ff}$ is the force that a perfect model says is needed to follow the reference (the gravity term $mg$ is used on Z only). The PID part then only has to correct what the model does not know, mainly the cutting force. The integral is paused while the output is saturated (anti-windup), and the derivative is low-pass filtered so that it does not amplify encoder steps.'),
  p(`Tuning by pole placement. Ignoring the integral, the closed loop of equations (${eqRef.plant}) and (${eqRef.pid}) has the characteristic equation on the left of (${eqNo + 1}); matching it to a standard second-order system with natural frequency $ω_{n}$ and damping ratio ζ gives the gains:`),
  eqn('s^{2}+\\frac{b+K_{d}}{m}s+\\frac{K_{p}}{m}=s^{2}+2ζω_{n}s+ω_{n}^{2}', 'char'),
  eqn('K_{p}=mω_{n}^{2},          K_{d}=2ζω_{n}m-b,          K_{i}=\\frac{K_{p}ω_{n}}{10}', 'gains'),
  p('With ζ = 0.8, a single number, the bandwidth $ω_{n}$, tunes all five axes. The integral gain is placed a decade below the bandwidth so that it removes steady errors without destabilising the loop. The next table lists the gains at $ω_{n}=2π·25$ rad/s; Section C of the Implementation compares bandwidths from 5 to 80 Hz.'),
  tcap('Axis models and pole-placement gains at 25 Hz (SI units: N, m or N m, rad)'),
  table([1100, 1900, 2000, 1800, 2226], ['Axis', 'm (kg or kg m²)', '$K_{p}$', '$K_{d}$', '$K_{i}$'],
    ['X', 'Y', 'Z', 'A', 'C'].map((ax, k) => [ax, [6, 6, 4, 0.02, 0.01][k], big(G.kp[k]), k > 2 ? f2(G.kd[k]) : big(G.kd[k]), big(G.ki[k])]), { centerCols: [0, 1, 2, 3, 4] }),
  p('The quality measure is the contour error: the distance from the actual tool position on the part to the nearest point of the intended path. Unlike the following error of a single axis, it is what appears on the machined surface:'),
  eqn('ε\\p{t}=\\lim{min}{s}{|p_{act}\\p{t}-p_{ref}\\p{s}|}', 'contour'),

  sub('8. Machine-learning tool monitoring'),
  p('The monitor turns two cheap signals into a decision every 0.1 s (Figure 4). Because no physical machine is available yet, the signals are generated from a simple physical model:'),
  ...fig('results/ml_pipeline.png', 'Tool-monitoring pipeline: signals → windows → features → classifier → action'),
  bullet([b('Cutting force. '), ('One pulse per tooth pass. For spindle speed n (rpm) and $z=2$ flutes, the tooth-passing frequency is $f_{tp}=zn/60$. The force grows with the feed factor f, the wear w and an unknown material factor $k_{m}$ between 0.7 and 1.5: $F\\p{t}=100k_{m}f\\p{1+0.8w}\\fn{max}{\\p{0, \\fn{sin}{2πf_{tp}t}}}$. A broken tooth removes every other pulse, and the remaining tooth cuts almost double.')]),
  bullet([b('Vibration. '), run('The force passed through the machine\'s structural resonance (1.3–1.7 kHz), plus noise that grows with wear (rubbing of a blunt edge). Chatter adds a large self-excited oscillation at the resonance.')]),
  bullet([b('Spindle current. '), run('Idle current (2 A) plus a term proportional to the average cutting force, plus sensor noise.')]),
  p('Each window of $N=1000$ samples gives eight features that a machinist can interpret (next table). Two of them are defined by the usual formulas for a signal $x_{1}…x_{N}$ with mean $x̄$ and standard deviation σ:'),
  eqn('RMS=\\sqrt{\\frac{1}{N}\\sum_{k=1}^{N}{x_{k}^{2}}},          kurtosis=\\frac{1}{Nσ^{4}}\\sum_{k=1}^{N}{\\p{x_{k}-x̄}^{4}}-3', 'feat'),
  tcap('The eight features and what they respond to'),
  table([600, 2800, 5626], ['#', 'Feature', 'Physical meaning'], [
    ['1', 'Feed (known)', 'Commanded chip load; lets the model separate feed from wear'],
    ['2', 'Cutting current / feed', '$\\p{Ī-I_{idle}}/f$: cutting force per unit feed; rises with wear (and with harder material)'],
    ['3', 'Current ripple', 'Standard deviation of the current'],
    ['4', 'Vibration RMS', 'Overall vibration level; rubbing of a worn edge raises it'],
    ['5', 'Vibration kurtosis', 'Spikiness of the signal; the impacts of a broken tooth raise it'],
    ['6', 'Chatter-band share', 'Share of vibration energy in 1.1–1.9 kHz, the resonance band'],
    ['7', 'Tooth-pass share', 'Share of energy at $f_{tp}$, the normal cutting rhythm'],
    ['8', '1×rev / tooth-pass', 'Energy at the spindle frequency over energy at $f_{tp}$; large when one tooth is missing'],
  ], { centerCols: [0] }),
  p('Three classifiers were trained on 1200 windows (300 per class) and tested on 400 new windows from a different random seed: (i) hand-written thresholds on features 2, 6 and 8, the "no machine learning" baseline; (ii) a decision tree of depth 4; (iii) a random forest of 100 trees. A decision tree chooses, at every node, the feature and threshold that make the two branches as pure as possible, measured by the Gini impurity of the class proportions $p_{c}$ in a node:'),
  eqn('Gini=1-\\sum_{c}{p_{c}^{2}}', 'gini'),
  p('A random forest trains B such trees, each on a random resample of the data and with a random subset of features at each node, and takes their majority vote:'),
  eqn('ŷ\\p{x}=\\fn{mode}{\\cb{h_{1}\\p{x}, h_{2}\\p{x}, …, h_{B}\\p{x}}}', 'vote'),
  p('Averaging many trees lowers the variance of a single tree. In the adaptive job the monitor runs once per second and the controller reacts: chatter → spindle speed +15% (moving out of the unstable speed range); worn → feed −20% and a tool-change flag; broken tooth → feed hold and spindle stop.'),

  sub('9. Part localisation: vision and probing'),
  sub2('9.1 Vision (coarse)'),
  p('The overhead camera image (0.4 mm pixels, uneven light, bright metal chips, 0.5% scale calibration error) is thresholded with Otsu\'s method, which tries every threshold t and keeps the one that best separates the dark and the bright pixels (class weights $ω_{0},ω_{1}$ and means $μ_{0},μ_{1}$):'),
  eqn('t^{*}=\\lim{arg max}{t}{ω_{0}\\p{t}ω_{1}\\p{t}\\sq{μ_{0}\\p{t}-μ_{1}\\p{t}}^{2}}', 'otsu'),
  p('Morphological opening (erosion then dilation) removes the chips, and the largest connected blob is taken as the part. Its centroid $q̄$ gives the position, and the direction of its longest axis, the main eigenvector $v$ of the second-moment (covariance) matrix of the blob\'s pixel positions $q_{k}$, gives the rotation:'),
  eqn('Σ=\\frac{1}{N}\\sum_{k}{\\p{q_{k}-q̄}\\p{q_{k}-q̄}^{T}},          θ=\\fn{atan2}{\\p{v_{y}, v_{x}}}', 'moments'),
  p('The corner of the part then follows from the centroid, the angle and the known part size.'),
  sub2('9.2 Touch probe (fine)'),
  p('The probe starts 3 mm before the edge predicted by the vision estimate and moves up to 6 mm until it touches (repeatability 2 µm). Three touch points $q_{1},q_{2},q_{3}$ on the long edge are fitted with a total-least-squares line: the line through their mean $q̄$ whose normal $n$ minimises the squared perpendicular distances,'),
  eqn('\\lim{min}{n}{\\sum_{k}{\\p{n^{T}\\p{q_{k}-q̄}}^{2}}},          |n|=1', 'tls'),
  p('which is the first principal direction of the points (found with a singular value decomposition). The angle of the line is the part rotation. Two touches on the short edge give a second line perpendicular to the first, and the intersection of the two lines is the corner. The result is judged by the worst error over the four part corners $c_{k}$ if the part were machined with the estimated pose $T_{est}$ instead of the true pose $T_{true}$:'),
  eqn('E=\\lim{max}{k}{|T_{est}\\p{c_{k}}-T_{true}\\p{c_{k}}|}', 'parterr'),

  sub('10. Simulator and hardware readiness'),
  p(`The 3D simulator (sim/cnc_sim.html, three.js) builds the machine as a chain of transforms that mirrors equation (${eqRef.R}): an A group rotating about x contains a C group rotating about z, which holds the table, the dome and the cut path; the spindle group moves by (X, Y, Z). Playing the planned joint values therefore shows the kinematics working: the tool stays on the dome and normal to it. For a real machine, the G-code uses joint coordinates with G93, which a LinuxCNC or grblHAL controller can run. The servo firmware turns an Arduino into a closed-loop drive for one DC-motor axis: STEP/DIR inputs give the target, quadrature interrupts count the encoder, and the same PID + feedforward law runs at 1 kHz with a following-error fault.`),
  sub('11. Workflow'),
  ...['Locate the part: camera → coarse pose → guided probing → fine pose (work offset).',
    'Generate the toolpath in part coordinates; run inverse kinematics; check collisions and limits.',
    'Plan move times under joint limits; write G93 G-code; verify by reading it back.',
    'Execute: interpolator → PID + feedforward servos → machine, while the ML monitor adapts speed and feed.',
    'Evaluate every stage against a baseline (run_all.py writes all figures and metrics used in this report).'].map(listPara('wf')),
  sub('12. Individual contribution'),
  p(`This is an individual project. ${STUDENT} (${REGNO}) carried out all of the work:`),
  table([2700, 6326], ['Area', 'Work done'], [
    ['Machine design', 'Chose the table-tilting layout, axis limits, tool and holder geometry'],
    ['Kinematics', 'Derived forward and inverse kinematics, solution selection, C unwrapping and singularity handling; verified by round trip'],
    ['Motion planning', 'Dome spiral CAM, holder collision check, velocity- and acceleration-limited feed planner, G93 G-code writer and reader'],
    ['Control', 'Axis models with friction, gravity and cutting load; interpolator; P / PID / PID + feedforward; pole-placement tuning; bandwidth study'],
    ['AI / ML', 'Signal model, feature design, rules vs decision tree vs random forest, adaptive machining logic'],
    ['Perception', 'Otsu and moments vision pipeline, guided touch probing with least-squares fitting, accuracy study'],
    ['Simulation and hardware', '3D three.js simulator, Arduino servo firmware, hardware guide, learning guide, this report'],
  ]),
];

// ---------- implementation ----------
const fw = src('firmware/axis_servo_pid/axis_servo_pid.ino'); while (fw[fw.length - 1] === '') fw.pop();
const gcode = src('results/dome_finish.ngc').slice(0, 14);
const simJs = [...between('sim/cnc_sim.html', '// A trunnion', '// Spindle'), '', ...between('sim/cnc_sim.html', 'function frame', 'resize();')];
const implementation = [
  heading('IMPLEMENTATION – CODING AND OUTPUT SCREENSHOT'),
  p('The project is written in Python 3 (NumPy, SciPy, scikit-learn, Matplotlib), JavaScript with three.js (3D simulator) and Arduino C++ (servo firmware). The listings below are the core functions, copied directly from the source files; plotting code is left out. Running python3 run_all.py regenerates every result, figure, the G-code and the simulator data in about 40 seconds.'),
  sub('A. Coding'),
  ...listing('Rotations, forward and inverse kinematics (kinematics.py)', blocks('kinematics.py', 'def rot_x', 'def rot_z', 'def table_rotation', 'def forward', 'def inverse', 'def limit_violations')),
  ...listing('Dome toolpath, collision check, inverse kinematics along the path, G-code writer and reader (toolpath.py)',
    blocks('toolpath.py', 'def surface_height', 'def dome_spiral', 'def holder_clearance', 'def to_joints', 'def write_gcode', 'def read_gcode')),
  ...listing('Feed-rate planner (motion_planner.py)', blocks('motion_planner.py', 'def joint_rates', 'def plan', 'def report')),
  ...listing('Pole-placement gains, loads, interpolator and servo simulation (axis_control.py)', blocks('axis_control.py', 'def gains', 'def load', 'def interpolate', 'def simulate', 'def errors')),
  ...listing('Tool-monitoring signals, features, baseline rules and adaptive job (tool_monitor.py)', blocks('tool_monitor.py', 'def make_window', 'def features', 'class Rules', 'def job_demo')),
  ...listing('Vision and touch-probe localisation (probing.py)', blocks('probing.py', 'def otsu', 'def vision', 'def probe_touch', 'def probe(', 'def part_error')),
  ...listing('3D simulator: kinematic chain and animation (sim/cnc_sim.html)', simJs),
  ...listing('Servo axis firmware for the real machine (firmware/axis_servo_pid/axis_servo_pid.ino)', fw),

  new Paragraph({ children: [new PageBreak()] }),
  sub('B. Output screenshots'),
  ...fig('results/screens/sim_t40.png', '3D simulator at 43 s: the table has tilted (A = 42°) and turned (C) while the tool stays normal to the dome; the red line is the path cut so far'),
  ...fig('results/screens/sim_t1.2.png', '3D simulator near the start: the tool is almost vertical (A = 9°), close to the singularity, so the planner has reduced the feed'),
  ...fig('results/toolpath.png', 'Spiral toolpath with tool axes (left) and the planned linear and rotary axis motion (centre, right)'),
  ...fig('results/feed_planning.png', 'Feed planning: the feed is reduced only near the top of the dome, where C would otherwise spin faster than its limit', 600, 'feed'),
  ...listing('First lines of the generated G-code (results/dome_finish.ngc)', gcode),
  ...fig('results/axis_control.png', 'Servo control: X following error, contour error, Z step against gravity and the bandwidth sweep'),
  ...fig('results/tool_monitor.png', 'Tool monitoring: vibration signatures, confusion matrix, feature importance and the adaptive job'),
  ...fig('results/tool_tree.png', 'Decision tree learned for tool monitoring (first two levels)', 520, 'tree'),
  ...fig('results/probing.png', 'Part localisation: camera image, vision estimate, probe touches and error comparison', 540),
];
const results = () => [
  sub('C. Results and performance analysis'),
  sub2('C.1 Kinematics, planning and G-code'),
  tcap('Feed planning for the dome program (2882 points)'),
  table([3300, 1300, 1500, 1500, 1400], ['Plan', 'Cycle (s)', 'Mean feed (mm/s)', 'Peak joint speed / limit', 'Peak joint accel / limit'],
    pl.cases.map((c) => [c.name, f1(c.cycle_s), f1(c.mean_feed), `${Math.round(100 * c.max_speed_ratio)}% (${c.worst_axis_speed})`, `${Math.round(100 * c.max_accel_ratio)}%`]), { centerCols: [1, 2, 3, 4] }),
  p(`At a constant feed the program would be impossible to run: near the singularity one axis would need ${Math.round(100 * c0.max_speed_ratio)}% of its top speed and ${Math.round(100 * c0.max_accel_ratio)}% of its acceleration. Enforcing the joint speed limits fixes both; after it, accelerations peak at ${Math.round(100 * c1.max_accel_ratio)}% of the limit, so the acceleration pass is a safety net that changes nothing for this path. The cost is only ${f1(c1.cycle_s - c0.cycle_s)} s (${f1(100 * (c1.cycle_s / c0.cycle_s - 1))}%), because the slow-down is confined to the first few seconds near the top of the dome (Figure ${figRef.feed}). The path uses A from ${f1(pl.A_range[0])}° to ${f1(pl.A_range[1])}°, the C table turns ${Math.round(Math.abs(pl.C_total))}° in total, there are ${pl.limit_violations} joint-limit violations, and the holder never comes closer than ${f1(pl.min_holder_clearance)} mm to the part. As a check that the collision test works, an 80° tilt just outside the foot of the dome gives ${f1(pl.steep_tilt_clearance)} mm, which is correctly reported as a collision. The ${pl.gcode_lines}-line G-code, read back and passed through forward kinematics, reproduces the tool path to ${f3(pl.gcode_roundtrip_error)} mm, the rounding of three decimals in the file.`),
  sub2('C.2 Servo control'),
  tcap('Servo control along the dome program (bandwidth 25 Hz)'),
  table([2000, 1500, 1500, 1500, 1300, 1226], ['Controller', 'RMS X error (µm)', 'RMS Z error (µm)', 'RMS C error (mdeg)', 'RMS contour (µm)', 'Max contour (µm)'],
    ['P', 'PID', 'PID+FF'].map((k) => [k === 'PID+FF' ? 'PID + feedforward' : k, f1(1000 * C[k].rms_follow[0]), f1(1000 * C[k].rms_follow[2]), f1(1000 * C[k].rms_follow[4]), f1(C[k].rms_contour_um), f1(C[k].max_contour_um)]),
    { centerCols: [1, 2, 3, 4, 5] }),
  tcap('Z axis: 1 mm step against gravity'),
  table([3000, 3000, 3026], ['Controller', 'Final error (µm)', 'Overshoot (µm)'],
    ['P', 'PID', 'PID+FF'].map((k) => [k === 'PID+FF' ? 'PID + feedforward' : k, f1(zs[k].final_err_um), f1(zs[k].overshoot_um)]), { centerCols: [1, 2] }),
  p(`The P controller lets Z sag ${f1(-zs.P.final_err_um)} µm under gravity: it only produces force when there is an error, so it needs an error of $mg/K_{p}$ to hold the axis up. The integral term builds that force up and removes the sag (${f1(Math.abs(zs.PID.final_err_um))} µm), but it overshoots ${f1(zs.PID.overshoot_um)} µm on a step because the integrator has to unwind. Feedforward supplies the expected force in advance, so the overshoot falls to ${f1(zs['PID+FF'].overshoot_um)} µm and the worst contour error along the program falls from ${f1(C.PID.max_contour_um)} to ${f1(C['PID+FF'].max_contour_um)} µm. The remaining X and Y error comes from the cutting force, which no model of the axis can predict; feeding back the force estimated by the tool monitor is a natural next step.`),
  tcap('Effect of the tuned bandwidth (PID + feedforward)'),
  table([2000, 2400, 2400, 2226], ['$ω_{n}$ (Hz)', 'RMS contour error (µm)', 'Max contour error (µm)', 'Comment'],
    sw.map((s) => [s.wn_hz, f1(s.rms_contour_um), f1(s.max_contour_um), s.wn_hz === 50 ? 'best overall' : s.wn_hz === 80 ? 'saturation, noise' : s.wn_hz < 25 ? 'too soft' : 'baseline']), { centerCols: [0, 1, 2] }),
  p(`Raising the bandwidth makes the axes stiffer against the cutting force: the RMS contour error falls by a factor of about ${Math.round(swAt(5).rms_contour_um / swAt(50).rms_contour_um)} from 5 to 50 Hz. At 80 Hz the RMS falls further but the worst error rises again, because the motors saturate in fast moves and the larger derivative gain amplifies encoder quantisation. About 50 Hz is therefore the best setting for this machine model; it is the optimisation result carried forward to the hardware tuning procedure.`),
  sub2('C.3 Machine-learning tool monitoring'),
  tcap('Tool-state classification on 400 unseen windows with unknown work material'),
  table([3600, 1700, 3726], ['Method', 'Accuracy', 'Notes'], [
    ['Hand-written threshold rules', pct(accR), 'Confuses normal and worn: harder material raises the current just as wear does'],
    ['Decision tree (depth 4)', pct(accT), `Readable if-then rules (Figure ${figRef.tree})`],
    ['Random forest (100 trees)', pct(accF), `Top features: ${imp.slice(0, 3).map(([k]) => k).join(', ')}`],
  ], { centerCols: [1] }),
  tcap('Per-class precision (P), recall (R) and F1: rules against random forest'),
  table([2200, 1150, 1150, 1150, 1150, 1100, 1126], ['Class', 'Rules P', 'Rules R', 'Rules F1', 'Forest P', 'Forest R', 'Forest F1'],
    CLS.map((c, k) => [c, ...prf(tm.confusion_rules, k).map(f2), ...prf(tm.confusion_rf, k).map(f2)]), { centerCols: [1, 2, 3, 4, 5, 6] }),
  p(`Chatter and broken teeth have unmistakable signatures (a large resonance peak; a strong once-per-revolution pulse), so even the rules detect them perfectly. The hard case is wear: a worn tool raises the cutting current, but so does a harder material, which the monitor does not know. The fixed current threshold therefore labels ${tm.confusion_rules[0][1]} of 100 normal windows as worn. The learned models combine the current with vibration RMS (rubbing of a blunt edge), which responds to wear but not to material, and reach ${pct(accT)} (tree) and ${pct(accF)} (forest). The decision tree is almost as accurate and can be read line by line, which matters when an operator has to trust an automatic stop. In the 120 s adaptive job the monitor agreed with the true state in ${Math.round(100 * tm.job_accuracy)}% of seconds: it raised the spindle speed at ${tm.job_actions[0][0]} s to leave the chatter zone, reduced the feed and flagged a tool change at ${tm.job_actions[1][0]} s as the wear passed the limit, and stopped the machine at ${tm.job_actions[2][0]} s when a tooth broke.`),
  sub2('C.4 Part localisation'),
  tcap('Part localisation over 300 random placements (up to 6 mm and 4° off)'),
  table([3800, 1500, 1800, 1926], ['Method', 'Part found', 'Mean error (mm)', 'Worst error (mm)'],
    Object.entries(M).map(([k, r]) => [k, pct(r.success), f3(r.mean_err_mm), f3(r.max_err_mm)]), { centerCols: [1, 2, 3] }),
  tcap('Angle error against the number of probe points on the long edge'),
  table([4500, 4526], ['Probe points on the long edge', 'Mean angle error (arc-seconds)'],
    pr.probe_points.map((n, k) => [n, f1(pr.angle_err_arcsec[k])]), { centerCols: [0, 1] }),
  p(`Machining at the nominal position would put features ${f1(nom.mean_err_mm)} mm off on average. Vision alone reaches ${f3(vis.mean_err_mm)} mm, limited by the pixel size, the uneven light and the camera calibration error. The probe is more than 100 times more accurate, but starting blind it missed the part in ${pct(1 - blind.success)} of placements, because the edge was outside its 6 mm search range. Vision-guided probing combines the range of the camera with the accuracy of the probe: ${pct(vp.success)} success with ${f3(vp.mean_err_mm)} mm error. More probe points average out the 2 µm probe noise, so the angle error falls from ${f1(pr.angle_err_arcsec[0])} to ${f1(pr.angle_err_arcsec[pr.angle_err_arcsec.length - 1])} arc-seconds from 2 to 12 points; three points were chosen as a good balance between accuracy and probing time.`),
];

// ---------- conclusion ----------
const conclusion = [
  heading('CONCLUSION'),
  p('An intelligent table-tilting 5-axis CNC machine was designed, simulated and evaluated. Each subsystem uses a method that can be explained step by step, and each was measured against a simpler baseline on test cases that were not used to design it.'),
  bullet([b('Kinematics and planning: '), (`closed-form inverse kinematics with solution selection and tool-centre-point compensation is exact to machine precision. The feed planner turned a program that needed ${f1(c0.max_speed_ratio)}× an axis's top speed into a feasible one for only ${f1(100 * (c1.cycle_s / c0.cycle_s - 1))}% more time. The collision check and the G-code round trip verify the output.`)]),
  bullet([b('Control: '), (`pole-placement PID with feedforward reduced the RMS contour error from ${f1(C.P.rms_contour_um)} µm to ${f1(C['PID+FF'].rms_contour_um)} µm and removed the gravity sag. The bandwidth study identified about 50 Hz (${f1(swAt(50).rms_contour_um)} µm) as the best setting.`)]),
  bullet([b('AI / ML: '), (`a random forest on eight physical features recognised tool states with ${f1(100 * accF)}% accuracy where fixed rules reached ${f1(100 * accR)}%, and closed the loop by changing speed, feed or stopping the machine.`)]),
  bullet([b('Perception: '), (`vision-guided probing located the part to ${f3(vp.mean_err_mm)} mm in every trial, combining the camera's range with the probe's accuracy.`)]),
  sub('Mapping to the evaluation rubrics'),
  table([3000, 6026], ['Rubric', 'Where it is addressed'], [
    ['Robot design and architecture', 'Machine layout and specification, system architecture (Methodology 1–3)'],
    ['Kinematics and motion planning', 'Forward/inverse kinematics, singularity, toolpath, collision check, feed planning, G-code (Methodology 4–6; Results C.1)'],
    ['AI / ML algorithm implementation', 'Decision tree and random forest tool monitoring with feature design (Methodology 8; Results C.3)'],
    ['Sensor integration and perception', 'Encoders, current and vibration sensing, camera vision, touch probe (Methodology 7–9; Results C.4)'],
    ['Robot control and navigation', 'PID + feedforward servo control, pole placement, adaptive feed and speed (Methodology 7; Results C.2)'],
    ['Innovation and critical thinking', 'Coarse-to-fine localisation; ML-driven adaptive machining; baselines and limitations stated'],
    ['Performance analysis and optimisation', 'Ablations, bandwidth sweep, probe-point study, per-class metrics (Results C.1–C.4)'],
    ['Simulation activities', '3D simulator, Python simulations of every subsystem, run_all.py'],
  ]),
  sub('Limitations'),
  bullet('Everything is simulated. Machine dynamics, sensor signals and images come from simple physical models; real gains, thresholds and classifiers must be re-tuned and retrained on measured data.'),
  bullet('The A and C axes are assumed to intersect, and collisions are checked only for the tool holder against the part and the table, not for the whole machine.'),
  bullet('The ball-end tool is kept exactly normal to the surface; real finishing adds a small lead angle so that the tool does not cut with the centre of the ball, where the cutting speed is zero.'),
  bullet('The feed planner limits velocity and acceleration but not jerk; the servo firmware has been syntax-checked but not run on hardware.'),
  sub('Future work'),
  bullet('Build the machine with LinuxCNC (xyzac-trt-kins kinematics with real pivot offsets) and DC servo axes using the provided firmware; identify the real axis masses and friction and re-tune.'),
  bullet('Record real current and vibration data and retrain the monitor; add tool-life prediction (regression on wear) and use the estimated cutting force as feedforward.'),
  bullet('Add lead and tilt angles, full 3D collision checking with machine models, and jerk-limited (S-curve) feed profiles.'),
  bullet('Create a ROS 2 / Gazebo digital twin connected to the real controller.'),
  sub('References'),
  ...['Y. Altintas, Manufacturing Automation: Metal Cutting Mechanics, Machine Tool Vibrations, and CNC Design, 2nd ed., Cambridge University Press, 2012.',
    'B. Siciliano, L. Sciavicco, L. Villani, G. Oriolo, Robotics: Modelling, Planning and Control, Springer, 2009.',
    'K. J. Åström, R. M. Murray, Feedback Systems: An Introduction for Scientists and Engineers, Princeton University Press, 2008.',
    'M. Tomizuka, "Zero phase error tracking algorithm for digital control," ASME J. Dynamic Systems, Measurement, and Control, 109(1), 1987.',
    'R. Teti, K. Jemielniak, G. O\'Donnell, D. Dornfeld, "Advanced monitoring of machining operations," CIRP Annals, 59(2), 2010.',
    'L. Breiman, J. Friedman, R. Olshen, C. Stone, Classification and Regression Trees, Wadsworth, 1984.',
    'L. Breiman, "Random forests," Machine Learning, 45(1), 2001.',
    'N. Otsu, "A threshold selection method from gray-level histograms," IEEE Trans. Systems, Man, and Cybernetics, 9(1), 1979.',
    'R. C. Gonzalez, R. E. Woods, Digital Image Processing, 4th ed., Pearson, 2018.',
    'F. Pedregosa et al., "Scikit-learn: Machine learning in Python," JMLR, 12, 2011.',
    'LinuxCNC documentation, "Kinematics" (xyzac-trt-kins) and "G-code: G93 inverse time feed", linuxcnc.org.'].map((r) => new Paragraph({
    numbering: { reference: 'ref', level: 0 }, alignment: AlignmentType.LEFT, spacing: { after: 40, line: 260 }, children: kids(r) })),
];

// ---------- evaluation sheet ----------
const A = (t, size, bold = true) => new TextRun({ text: t, font: 'Arial', size, bold });
const aPara = (t, size, o = {}) => new Paragraph({ spacing: { after: 80 }, ...o, children: [A(t, size)] });
const rubrics = [['Robot Design and Architecture', 5], ['Kinematics and Motion Planning', 5], ['AI / ML Algorithm Implementation', 5],
  ['Sensor Integration and Perception', 5], ['Robot Control and Navigation', 5], ['Innovation and Critical Thinking', 4],
  ['Performance Analysis and Optimization', 4], ['Presentation and Viva Voce', 4], ['Completeness of the Report', 3]];
const levels = (m) => (m === 5 ? ['5', '4', '3', '0–2'] : m === 4 ? ['4', '3', '2', '0–1'] : ['3', '2', '1', '0']);
const evaluation = [
  new Paragraph({ alignment: AlignmentType.CENTER, pageBreakBefore: true, spacing: { after: 280 }, children: [A('EVALUATION SHEET', 28)] }),
  aPara('Reg.No :', 28), aPara('Name:', 28), aPara('Course code: 24AI2003', 28), aPara('Course Name: INTELLIGENT ROBOTICS', 28, { spacing: { after: 240 } }),
  table([900, 4000, 1800, 1800], ['S.No', 'Rubrics', 'Maximum Marks', 'Marks Obtained'],
    [['1', 'Simulation Activities', '10', ''], ['2', 'Intelligent Robotics Project', '30', ''], ['', 'Total', '40', '']],
    { font: 'Arial', size: 26, centerCols: [0, 2, 3], plainHeader: true }),
  gap(200),
  table([800, 4600, 1700, 1900], ['S. No.', 'Rubrics', 'Maximum Marks', 'Marks Obtained'],
    [...rubrics.map(([r, m], k) => [String(k + 1), r, String(m), '']), ['', 'Total', '40', '']],
    { font: 'Arial', size: 20, centerCols: [2], plainHeader: true, boldBody: true, pad: 20 }),
  gap(160),
  new Paragraph({ children: [A('Performance-Level Assessment', 20)] }),
  new Paragraph({ spacing: { after: 120 }, children: [A('Use the following performance levels to evaluate each rubric.', 20)] }),
  table([4200, 1150, 1150, 1150, 1376], ['Rubrics', 'Excellent', 'Good', 'Average', 'Below Average'],
    rubrics.map(([r, m]) => [`${r} (${m})`, ...levels(m)]), { font: 'Arial', size: 20, centerCols: [1, 2, 3, 4], plainHeader: true, boldBody: true, pad: 20 }),
  new Paragraph({ children: [new PageBreak()] }),
  table([1800, 7226], ['Level', 'Description'], [
    ['Excellent', 'Demonstrates outstanding technical knowledge, accurate implementation, effective integration, and innovative problem-solving.'],
    ['Good', 'Demonstrates good understanding and implementation with minor errors or improvements needed.'],
    ['Average', 'Demonstrates basic understanding and partial implementation with noticeable limitations.'],
    ['Below Average', 'Demonstrates limited understanding, incomplete implementation, and significant technical issues.'],
  ], { font: 'Arial', size: 24, plainHeader: true }),
  new Paragraph({ spacing: { before: 240 }, children: [A('Suggested assessment areas: ROS/ROS2, Gazebo or other robotics simulators, sensor data processing, path planning, PID control, computer vision, and robot performance evaluation, depending on the project.', 24, false)] }),
  new Paragraph({ alignment: AlignmentType.RIGHT, spacing: { before: 1600 }, children: [A('Signature of the Faculty-in-charge', 24)] }),
];

// ---------- document ----------
const numCfg = (ref) => ({ reference: ref, levels: [{ level: 0, format: LevelFormat.DECIMAL, text: ref === 'ref' ? '[%1]' : '%1.',
  alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 540, hanging: 400 } } } }] });
const page = { size: { width: 11906, height: 16838 }, margin: { top: 1440, bottom: 1440, left: 1440, right: 1440 } };
const doc = new Document({
  creator: STUDENT, title: TITLE,
  styles: { default: { document: { run: { font: TNR, size: 24 } } } },
  numbering: { config: [
    { reference: 'bul', levels: [{ level: 0, format: LevelFormat.BULLET, text: '•', alignment: AlignmentType.LEFT,
      style: { paragraph: { indent: { left: 540, hanging: 300 } } } }] },
    numCfg('obj'), numCfg('wf'), numCfg('ref'),
  ] },
  sections: [
    { properties: { page }, children: [...cover, ...titlePage] },
    { properties: { page: { ...page, pageNumbers: { start: 1 } } },
      footers: { default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.CENTER,
        children: [new TextRun({ children: [PageNumber.CURRENT], font: TNR, size: 20 })] })] }) },
      children: [...abstract, ...problem, ...methodology, ...implementation, ...results(), ...conclusion, ...evaluation] },
  ],
});
Packer.toBuffer(doc).then((buf) => {
  fs.writeFileSync(ROOT + 'IA3_REPORT_CNC.docx', buf);
  console.log(`written IA3_REPORT_CNC.docx: ${figNo} figures, ${tabNo} tables, ${eqNo} equations, ${lstNo} listings`);
});
