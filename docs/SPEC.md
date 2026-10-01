# Physics Data Web App — MVP

> Product specification written by Vladimir Lopez. This is the source of truth for **what** to build.
> `AGENTS.md` covers **how** to work in this repo. If they ever conflict, stop and ask Vladimir.

Build the first working prototype of a browser-based physics laboratory data acquisition and analysis application for high-school physics.

The long-term goal is a commercial-quality application that works with Vernier Go Direct sensors, especially Go Direct Photogates and Go Direct Sensor Carts, but do not attempt to build the entire platform yet.

The primary design principle is:

**The software should expose only the measurements and analysis tools students need for the current experiment.**

The application should be dramatically simpler and clearer for introductory physics students than a general-purpose data acquisition application.

## Phase 1: Falling-object photogate experiment

Build only the first experiment module.

Students have several photogates positioned at different vertical locations. The photogates measure the times at which an object passes them. Students independently measure and enter the vertical position/height of each photogate.

The application combines:

* photogate time
* student-entered position

to investigate position, velocity, and acceleration.

## Technology

Create this as a client-side web application.

Preferred stack:

* React
* TypeScript
* Vite
* modern responsive CSS
* a suitable open-source plotting library
* Vitest for unit tests

Keep dependencies minimal.

The application should eventually be deployable as a static website.

Do not require:

* accounts
* login
* database
* server
* cloud storage

All experimental data should initially remain in the browser.

Architect hardware acquisition separately from data analysis and UI so that simulated data can later be replaced by real Vernier Go Direct data without rewriting the application.

## Core architecture

Separate the application into roughly these layers:

### Sensor acquisition

Define an interface representing a photogate data source.

Implement:

1. SimulatedPhotogateSource
2. placeholder architecture for a future GoDirectPhotogateSource

Do NOT fake actual Vernier integration.

For now, simulated mode must allow development and testing without physical hardware.

### Experiment data

Represent each measurement approximately as:

```ts
interface PhotogateMeasurement {
  gateId: string;
  position: number;
  time: number;
}
```

Use SI units internally:

* position: meters
* time: seconds
* velocity: m/s
* acceleration: m/s²

### Physics analysis

Keep physics/math functions independent from React components.

Implement tested functions for:

* quadratic least-squares regression
* linear least-squares regression
* R²
* evaluating fitted functions
* derivative of the quadratic position model
* calculation of instantaneous velocity from the quadratic fit

For

x(t) = At² + Bt + C

calculate

v(t) = 2At + B

and

a = 2A.

Do not hide these relationships from students.

## Student workflow

Design the interface around a clear progression.

### 1. Experiment setup

Show:

**Falling Motion — Photogates**

Allow the student to select:

* Simulated Data
* Vernier Go Direct Photogate

The Vernier option can initially be marked as experimental/not yet implemented.

Provide a prominent:

**Connect / Start Experiment**

control.

Avoid technical sensor configuration unless absolutely necessary.

### 2. Data collection

Create a clean table:

| Gate | Position (m) | Time (s) |
|---|---|---|
| 1 | editable | measured |
| 2 | editable | measured |
| 3 | editable | measured |

Students enter photogate positions.

Times come from the simulated sensor source.

Make the table extremely readable.

The entire reason for this project is that raw photogate data is difficult for students to identify and interpret in general-purpose data acquisition software.

Include:

* Add Gate
* Remove Gate
* Reset Experiment

Validate inputs and clearly identify missing measurements.

### 3. Position vs. time

Plot the measured points as:

**Position vs. Time**

x-axis: Time (s)

y-axis: Position (m)

Provide:

**Quadratic Fit**

After fitting, overlay the fitted curve and display:

x(t) = At² + Bt + C

Display numerical A, B, C and R².

Then display the physical interpretation:

Initial velocity = B

Acceleration = 2A

Do not simply present numbers. Make the connection between the mathematical coefficients and the physics visible.

### 4. Instantaneous velocity

Provide:

**Create Velocity Graph**

Use the derivative of the fitted position function:

v(t) = 2At + B

Calculate instantaneous velocity corresponding to the experimental times.

Display a new:

**Velocity vs. Time**

graph.

Show the linear equation:

v(t) = mt + b

and connect:

m = acceleration.

Students should be able to visually understand:

position → quadratic model → derivative → velocity → acceleration.

### 5. Linearization

Provide a separate:

**Linearize Data**

analysis mode.

Do NOT immediately tell students which transformation to use.

Allow them to choose variables such as:

* t
* t²
* position

For this first version, support plotting position versus t².

Display the transformed data table.

Allow:

**Linear Fit**

Show:

y = mx + b

and R².

Keep the original position-vs-time graph available so students can compare the nonlinear and linearized representations.

## UI philosophy

This application is for high-school physics students, not professional scientists.

Prioritize:

* very large readable graphs
* minimal controls
* obvious units
* clear mathematical notation
* large touch-friendly buttons
* progressive disclosure
* responsive Chromebook/laptop/tablet layout

Avoid:

* dense dashboards
* tiny toolbars
* unexplained icons
* giant configuration menus
* unnecessary sensor channels
* raw diagnostic information
* excessive visual decoration

Use mathematical notation where appropriate.

The graphs are the most important elements on the screen.

## Teacher/demo mode

Provide a built-in sample experiment so the entire workflow can be demonstrated without hardware.

Generate realistic but clearly labeled simulated falling-motion data with small measurement variation.

Do not hard-code analysis results. The normal regression functions must analyze the simulated measurements.

Provide:

**Load Example Experiment**

## Export

Allow exporting the experiment measurements as CSV containing at minimum:

* gate
* position_m
* time_s

Design the data model so calculated quantities can be added later.

## Future requirements — architecture only

Do not implement these yet, but avoid architectural decisions that would prevent them:

* Vernier Go Direct Photogate integration
* multiple photogates
* Go Direct Sensor Cart
* position/velocity/acceleration acquisition
* force measurements
* Newton's Second Law experiments
* impulse and momentum
* energy experiments
* experiment-specific modules
* teacher-created experiment configurations
* saving/loading experiments
* additional regression models
* uncertainty/error analysis
* student-generated lab reports

## Vernier integration

The eventual hardware implementation should investigate Vernier's official @vernier/godirect JavaScript library.

Do not reverse-engineer Vernier protocols if the official library provides the required functionality.

Keep all Vernier-specific code isolated from the analysis and UI layers.

Before implementing hardware support, inspect the official library/documentation and determine:

1. browser requirements
2. Web Bluetooth/WebHID requirements
3. photogate channels exposed by the API
4. event/timing data format
5. whether multiple Go Direct Photogates can be connected simultaneously
6. limitations imposed by browser security

Document those findings separately before changing the application architecture.

## Testing

Write unit tests for the mathematical analysis.

At minimum test a known trajectory such as:

x(t) = 1 + 2t + 5t²

The regression should recover approximately:

A = 5
B = 2
C = 1

The derived quantities should therefore be:

v(t) = 10t + 2

a = 10 m/s².

Also test:

* imperfect/noisy measurements
* insufficient data
* duplicate times
* missing positions
* invalid numerical input

The UI should fail gracefully rather than displaying NaN or Infinity.

## Development process

Do not try to implement everything at once.

Work in this order:

1. Set up project structure.
2. Define experiment/data models.
3. Implement and test physics/math functions.
4. Implement simulated photogate source.
5. Build measurement table.
6. Build position-vs-time graph.
7. Add quadratic regression.
8. Add derivative/velocity analysis.
9. Add velocity-vs-time graph.
10. Add linearization.
11. Add CSV export.
12. Polish the student workflow.
13. Only after the simulated workflow is reliable, investigate actual Vernier hardware integration.

After each major stage, run tests and verify the application still builds.

## First task

Start by examining this specification and proposing a concise project architecture and file structure.

Then scaffold the application and implement only stages 1–4:

* project structure
* data models
* tested physics/math functions
* simulated photogate source

Do not proceed to the full UI yet.

At the end, report:

* files created
* architectural decisions
* tests implemented
* assumptions made
* questions or risks concerning the eventual Vernier integration
* recommended next implementation step
