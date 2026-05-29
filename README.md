# ORCA — Exploring an Ocean of Sound

ORCA is a premium, state-of-the-art music discovery platform designed as a living ecosystem of sound. Built using Next.js, React Three Fiber (Three.js), and d3-force-3d, ORCA presents a gorgeous, interactive 3D particle sphere representing the global network of music culture. 

Instead of typing standard queries into an analytics dashboard, ORCA encourages listeners to **navigate, explore, and discover** connections between artists in an ocean of sound.

---

## 🌊 Core Philosophy

* **Exploratory**: Discover new territories, hidden currents, and unexpected connections between musical icons.
* **Premium & Intelligent**: Harmonious color palettes, sleek glassmorphism HUD, dynamic magnifying physics, and mathematically perfect animations.
* **Discovery over Consumption**: Navigating the natural ecosystem of music culture rather than using standard recommendations.

---

## 🛠️ Technology Stack

* **Front-End Core**: Next.js, React (TypeScript), Vanilla CSS
* **3D Layout & Physics**: React Three Fiber (R3F), `@react-three/drei`, `three.js`
* **Layout Engine**: `d3-force-3d` (constraining node charging and link attraction forces onto a 3D sphere)
* **State Management**: Zustand
* **Primary Discovery Engine**: Last.fm API (Core data fetching, spatial layouts, progressive expansion, and genre taxonomy)

---

## 📡 Data & Network Architecture

ORCA has a robust, clean, and extremely high-performance data architecture:

### 1. Last.fm Primary Discovery
Last.fm serves as the single source of truth for artist popularities, discovery, listener counts, biographies, genre tagging (`tag.getTopArtists`), and similarity charts (`artist.getSimilar`). This guarantees that our graph represents actual, modern music culture.

### 2. Seeding & Cultural Representation
To ensure the sound globe is beautifully populated on the very first load, the platform seeds modern icons for **all 25 major genres** (e.g. Kendrick Lamar, Travis Scott, Drake, Fred again.., Skrillex, Coldplay, Daft Punk, Ludovico Einaudi, Aretha Franklin). No region of the globe is ever left empty.

### 3. Server-Side Graph Cache (`src/lib/graph/orca-cache.json`)
Initial API loads fetch, process, and compile **1,104 nodes** and **2,765 edges** into a local JSON cache on the server.
* Bypasses external API latency and public rate-limiting entirely.
* Loads **instantaneously (0 seconds)** from disk on initial startup.
* Fully self-healing: if the cache file is deleted, the server queries the Last.fm endpoints to rebuild and write it back.

### 4. Canonical Identity & Deduplication Layer (`src/lib/identity.ts`)
To enforce a strict **"one artist = one node"** policy, ORCA implements an advanced normalization and alias-resolution layer:
* **Collaboration Splitting**: Intelligent parsing checks collaborative name strings containing `&`, `and`, `feat`, `with`, or `vs`. If a collaboration is detected, it splits the names and automatically resolves them to their canonical primary artists (e.g. merging `"Jay-Z & Kanye West"` into `"Jay-Z"`, and `"Kanye West & André 3000"` into `"Kanye West"`).
* **Deterministic Name IDs**: Generates stable node IDs derived purely from normalized canonical names, completely eliminating duplicate artist profiles (such as Drake profiles where one had an MBID and another didn't).

---

## 🎨 Visual Spacing & Interaction Physics

* **Optimal Globe Spacing**: Features an expanded default sphere radius (`R = 1.65`) providing **40% more surface area** to distribute nodes cleanly, coupled with a strengthened d3-force charge repulsion (`-0.035`) to keep nodes beautifully spaced.
* **Magnifying Bubble Repulsion (`NodeField.tsx`)**: Hovering over an artist node snaps it satisfyingly to the cursor while applying a physical displacement bubble (`effect * 0.75`) that pushes all neighboring nodes away. This clearing of space prevents overlapping labels and text collisions.
* **Calm Periodic Breathing Loops**: Frontier nodes breathe in and out using a mathematically periodic `time % (Math.PI * 2)` cycle. Scale variations are softened (`0.86` to `1.02`) to ensure calming, continuous loops with no jumps or restarts.
* **Stable Selection & Search Clearing**: Clicking an artist pins them permanently. Clicking a different node automatically clears any active search query, stabilizing your selection and preventing background progressive expansions from overriding manual selections.
* **Fluid Autocomplete Dropdown**: Search inputs support full keyboard navigation (`ArrowUp` / `ArrowDown` to traverse suggestions, `Enter` to select and pin) with active visual highlights.

---

## 🚀 Installation & Local Setup

### Prerequisites
* Node.js (v18.x or higher)
* Last.fm Developer API Account (free and instant)

### 1. Clone the repository
```bash
git clone https://github.com/YOUR_USERNAME/musicorca.git
cd musicorca
```

### 2. Configure Environment Variables
Create a `.env` file in the root directory and add your Last.fm API Key:
```env
LASTFM_API_KEY=your_lastfm_api_key_here
```

### 3. Install Dependencies
```bash
npm install
```

### 4. Run Pre-Build Cache (Optional but Recommended)
To pre-compile the 1,104-node graph cache immediately on disk:
```bash
npx tsx scratch/prebuild.ts
```

### 5. Run the Development Server
```bash
npm run dev
```
Open [http://localhost:3000](http://localhost:3000) with your browser to explore the ocean of sound!

---

## ⚖️ License

Distributed under the MIT License. See `LICENSE` for more information.
