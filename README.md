# AEGIS EYE

**Adaptive Event Ground Intelligence System**

A 3D Digital Twin Command Center for real-time crowd management at large-scale venues (52,000 capacity).

Built during the [Prompt Wars Virtual Hackathon](https://hack2skill.com) by Google for Developers.

**Live Demo:** [aegis-eye-twin.web.app](https://aegis-eye-twin.web.app) | [Cloud Run](https://aegis-eye-161559140373.us-central1.run.app)

---

## The Problem

Crowd disasters at concerts, festivals, and sporting events keep happening. Not because we lack sensors or cameras, but because there is no unified system that treats the crowd as a dynamic, living system and makes decisions before dangerous conditions form.

Most venues still rely on walkie-talkies, static signage, and reactive decision-making. AEGIS EYE exists to change that.

## What It Does

AEGIS EYE simulates the full lifecycle of a 52,000-person concert event inside an interactive 3D environment. From parking lot arrival, through gate entry, the live performance, all the way to post-event egress and venue clearance.

At the center sits a Reinforcement Learning agent (PPO policy) that continuously monitors crowd density, gate congestion, and amenity queues. It makes routing decisions in real-time: redirecting foot traffic to less congested gates, rebalancing parking lots, triggering signage updates, and deploying staff, all without human intervention.

### Core Capabilities

**3D Venue Simulation**
- Full stadium bowl with tiered seating, standing pit (GA), main stage, LED screens, and speaker stacks
- 3 operational gates (East and West for entry, South for exit) with lane barriers and canopy structures
- 4 food courts, 4 restroom blocks, 3 merchandise stores
- 3 parking lots with individual car meshes that visually drain during egress
- 20 floating sensor nodes (LiDAR, thermal, pressure, radar) with beam visualization
- 14 staff markers (gate security, roaming, medical) with AI-driven repositioning

**Crowd Dynamics (8,000 particles)**
- State machine per particle: Parking > Walk to Gate > Enter > Inside Venue > Exit to Gate > Walk to Parking > Drive Away > Gone
- Three crowd roles: attendees (85%), parking idlers/tailgaters (8%), outside wanderers (7%)
- Natural movement with individual speed variance and random drift
- Full egress simulation where every person leaves the venue, walks to parking, and drives off-screen

**RL Agent**
- Proximal Policy Optimization brain running continuously
- Monitors gate congestion and routes arrivals to the least loaded entry gate
- Switches between OPTIMIZE, EGRESS, and EMERGENCY policies based on event phase
- Visual feedback: glowing arrows on preferred gate, emissive gate highlighting
- Live metrics: confidence score, actions per minute, cumulative reward

**Visualization Modes**
- **Heatmap**: Gaussian-blurred density grid overlaid on the venue floor
- **Flow**: 3,000-particle directional flow field showing crowd movement patterns
- **Queues**: Amenity load monitoring with wait time tracking
- **Prediction**: Density rings that change color (green > amber > red) based on projected congestion
- **Emergency**: Combined heatmap + prediction with heightened visual contrast

**Crowd Surge Simulation**
- One-click surge trigger in the standing pit zone
- Particles physically pulled toward the surge epicenter
- RL agent auto-switches to EMERGENCY policy
- Cascading response: LED floor strips, PA system, staff redeployment, relief gate opening, medical dispatch
- Full resolution sequence with density normalization

**Event Timeline**
- Scrubable timeline covering: Gates Open > Peak Entry > Show Start > Show End > Cleared
- Playback at 1x, 2x, 4x, 8x speed
- Phase-aware badge system (Pre-Event, Arrival, Peak, Live, Egress, Cleared)
- Auto-generated contextual alerts during playback

**Camera System**
- Mouse-drag orbital controls with scroll zoom
- 4 camera presets: Overview, Entry Gates, Standing Pit, Aerial
- Smooth interpolated transitions between positions

## Tech Stack

| Layer | Technology |
|-------|-----------|
| 3D Engine | Three.js (r128) |
| Logic | Vanilla JavaScript (no frameworks) |
| Styling | Vanilla CSS with glassmorphism design system |
| Typography | Inter + JetBrains Mono (Google Fonts) |
| Hosting | Google Cloud Run + Firebase Hosting |
| Container | Docker (nginx:alpine) |
| Build | Google Cloud Build |
| Registry | Google Artifact Registry |

Zero dependencies. No npm packages. No build step. Opens directly in any modern browser.

## File Structure

```
PromtWar/
  index.html       # Application shell and UI layout (344 lines)
  app.js            # Simulation engine, 3D rendering, RL agent (1,432 lines)
  styles.css        # Design system and responsive styles (963 lines)
```

## Running Locally

No install needed. Just open the file:

```
# Option 1: Direct file open
Open index.html in any browser

# Option 2: Local server
npx serve .
```
## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| Space | Play / Pause timeline |
| 1 | Heatmap mode |
| 2 | Flow mode |
| 3 | Queue mode |
| 4 | Prediction mode |
| 5 | Emergency mode |
| S | Trigger crowd surge |
| Mouse drag | Orbit camera |
| Scroll | Zoom in/out |

## What This Means for Venue Operators

Instead of watching 200 camera feeds and guessing where the next bottleneck forms, an operator gets a single screen with complete situational awareness, predictive intelligence, and an AI co-pilot that is already acting on problems they have not noticed yet.

---

Built with Google Cloud credits from Prompt Wars Virtual Hackathon.

#BuildwithAI #PromptWarsVirtual | @Google for Developers | @Hack2skill
