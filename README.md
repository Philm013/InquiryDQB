# InquiryDQB - The Digital Question Board

**A real-time, peer-to-peer digital question board for dynamic classroom inquiry.**

InquiryDQB is a web-based application designed to replace the physical whiteboard and sticky notes in a modern, tech-enabled classroom. It provides teachers with an infinite canvas to organize activities and a powerful console to guide lessons, while students use a simple companion app on their devices to contribute, collaborate, and participate in real-time.


*(Replace this with a screen recording or GIF of your application in action)*

---

## Table of Contents

- [About The Project](#about-the-project)
- [Key Features](#key-features)
- [Getting Started (User Guide)](#getting-started-user-guide)
  - [For Teachers](#for-teachers)
  - [For Students](#for-students)
- [Technical Details](#technical-details)
  - [Technology Stack](#technology-stack)
  - [Core Architecture](#core-architecture)
  - [File Structure](#file-structure)
  - [Running Locally](#running-locally)
- [Roadmap](#roadmap)
- [License](#license)

---

## About The Project

The goal of InquiryDQB is to foster inquiry-based learning by making it easy for students to share their thoughts (notices, wonders, ideas) and for teachers to collect, organize, and act on that input.

The core of the application is a **peer-to-peer (P2P)** connection powered by **WebRTC (via PeerJS)**. This means:
*   **No Server Costs:** Once the initial connection is made, data is sent directly between the teacher's and students' devices.
*   **Low Latency:** Communication is incredibly fast, creating a responsive, real-time experience.
*   **Privacy:** Classroom data is not stored on a central server during the session.

All board data is saved locally in the teacher's browser using **IndexedDB**, and students' contributions are saved on their own devices, allowing for persistence across sessions.

## Key Features

### Teacher Console

*   **Infinite Canvas:** Pan, zoom, and arrange content on a limitless digital whiteboard.
*   **Rich Content Creation:**
    *   **Notes:** Create color-coded notes for Notices, Wonders, Ideas, and more.
    *   **Zones:** Group notes into dedicated areas for activities. Specialized zones include **CER (Claim, Evidence, Reasoning)** and **Consensus Models**.
*   **Interactive Widgets:**
    *   **Polls:** Create live multiple-choice polls.
    *   **Graphs:** Collect and display numerical data from students in real-time.
    *   **Spinners:** Create a fun, randomized spinner from a list of options.
*   **Real-time Activities:**
    *   **Vote:** Allow students to vote on a selection of notes.
    *   **Rank/Sort:** Have students rank notes in order of importance.
    *   **Discuss:** Create a focused discussion thread around specific notes.
*   **Exit Tickets:** Launch various types of exit tickets (short answer, multiple choice, smiley-face rating) to assess understanding.
*   **Classroom Management:**
    *   View a live **roster** of connected students.
    *   Share a session via **QR Code** or a simple ID.
    *   Control the flow of the lesson by locking the board or opening specific activities.
*   **Productivity Tools:**
    *   **Minimap** for easy navigation.
    *   **Multi-select** and **arrangement tools** (align, distribute, group).
    *   **Undo/Redo** functionality.
    *   **Templates** for common classroom setups (KWL, Frayer Model, etc.).

### Student Companion

*   **Simple Onboarding:** Join a class with a name, an avatar, and a quick QR scan.
*   **Focused Interface:** The UI changes dynamically based on the teacher's current activity.
*   **Contribute Ideas:** Submit text notes and sketches directly to the board or a specific activity zone.
*   **Participate Actively:** Engage in voting, ranking, discussions, polls, and exit tickets.
*   **Personal History:** View a list of all personal contributions made during the session.
*   **Device Friendly:** Fully responsive design works on phones, tablets, and computers.

---

## Getting Started (User Guide)

### For Teachers

1.  **Launch:** Open the landing page (`index.html`) and click **"I'm a Teacher"**, or navigate directly to `/Teacher/index.html`.
2.  **Create a Board:** Click "+ New Board" to start fresh, or select a previously saved board from the list.
3.  **Share Your Session:**
    *   In the bottom toolbar, click `Board ⚙️` > `Share 📡`.
    *   A modal will appear with a **QR Code** and a unique **Session ID**.
    *   Have students scan the QR code or manually enter the ID.
4.  **Build Your Board:**
    *   Use the `Add ➕` button in the toolbar to create notes, zones, and interactive widgets.
    *   Arrange them on the canvas as needed.
5.  **Run an Activity:**
    *   **To open the entire board for contributions:** Click `Board ⚙️` > `Open Board 🔓`.
    *   **To run a zone-based activity (like voting):** Select a zone or a group of notes, right-click (or long-press) to open the context menu, and choose `Vote`, `Rank`, or `Discuss`.
    *   **To launch an Exit Ticket:** Click `Add ➕` > `Exit Ticket 🚪` and choose the type.
6.  **Monitor Progress:**
    *   Click the `Menu ☰` button to open the sidebar.
    *   The **Roster** tab shows connected students.
    *   The **Activity** tab shows real-time results for the current activity.

### For Students

1.  **Launch:** Open the landing page (`index.html`) and click **"I'm a Student"**, or navigate directly to `/Student/index.html`.
2.  **Set Up Profile:** Choose an avatar emoji and enter your name.
3.  **Join the Class:**
    *   Click **"Scan QR Code"** and point your device's camera at the code on the teacher's screen.
    *   Alternatively, type the Session ID into the input box and click "Connect Manually".
4.  **Participate:**
    *   Your screen will show **"Eyes on the Board"** when you are waiting for the teacher.
    *   When the teacher opens an activity, your screen will update with buttons to contribute notes, vote on options, or complete the assigned task.
    *   Your contributions will appear in the "Your Contributions" list at the bottom.

---

## Technical Details

### Technology Stack

*   **Frontend:** Vanilla HTML, CSS, and JavaScript. No frameworks are used, keeping the project lightweight and dependency-free.
*   **P2P Networking:** [PeerJS](https://peerjs.com/) (A JavaScript library that wraps the browser's WebRTC implementation for easy peer-to-peer data connections).
*   **Local Database:** [IndexedDB API](https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API) is used for robust client-side storage of board data (teacher) and user profiles/notes (student).
*   **QR Codes:** [qrcode.js](https://github.com/davidshimjs/qrcodejs) (Teacher) and [html5-qrcode](https://github.com/mebjas/html5-qrcode) (Student) for QR code generation and scanning.
*   **Utilities:** [Chart.js](https://www.chartjs.org/) for graph widgets, [canvas-confetti](https://github.com/catdad/canvas-confetti) for visual feedback.

### Core Architecture

*   **Peer-to-Peer (P2P) Model:** The Teacher application acts as the "host" peer. All Student applications connect directly to the teacher as "client" peers. A public PeerJS server is used for the initial connection handshake (discovery), but after that, all application data (notes, activities, etc.) flows directly between the peers.
*   **State Management:** The global application state is managed in a single `window.State` object in each application. The Teacher's `State` is the canonical source of truth for the board.
*   **Event-Driven Communication:** Actions are broadcast between peers as JSON objects with a `type` property (e.g., `{type: 'NOTE', text: 'Hello', ...}`). A central `Network.handle()` function on the receiving end acts as a router to process these messages and update the local state.
*   **DOM Render Engine:** The application uses a custom render loop (`requestAnimationFrame`) that syncs the DOM with the current `State` object. It intelligently creates, updates, or removes DOM elements based on the data, without relying on a virtual DOM.

### File Structure

The project is organized into a simple, self-contained structure.

```
/
├── index.html         (Main Landing Page)
├── README.md          (This file)
└── /Teacher/
│   └── index.html     (The Teacher Console single-page application)
└── /Student/
    └── index.html     (The Student Companion single-page application)
```

### Running Locally

Because the applications use browser APIs like WebRTC and IndexedDB, they must be served from a web server. You cannot simply open the `index.html` files from your local file system.

1.  **Clone or download the repository.**
2.  **Navigate to the root directory** in your terminal.
3.  **Start a local web server.** A simple way is to use the `http-server` NPM package:
    ```bash
    # Install the server globally (if you haven't already)
    npm install -g http-server

    # Start the server in the project's root directory
    http-server
    ```
    Alternatively, you can use Python's built-in server:
    ```bash
    # For Python 3
    python3 -m http.server

    # For Python 2
    python -m SimpleHTTPServer
    ```
4.  **Access the application:** Open your web browser and navigate to the local address provided by the server (e.g., `http://localhost:8080`).

---

## Roadmap

This project is a functional proof-of-concept with many opportunities for expansion.

*   [ ] **Enhanced Co-Host Functionality:** Define specific permissions for co-hosts (e.g., read-only vs. full control).
*   [ ] **Student Groups:** Allow teachers to create and manage student groups on the canvas for breakout activities.
*   [ ] **More Widgets:** Add new tools like a Word Cloud, Timer, or collaborative drawing area.
*   [ ] **Export Options:** Allow teachers to export the final board state as an image (PNG/SVG) or a printable PDF.
*   [ ] **Cloud Persistence (Optional):** Integrate with a backend service (like Firebase) to allow teachers to save/load boards to an account and access them from any device.
*   [ ] **Code Refactoring:** Break down the monolithic JavaScript in each `index.html` into smaller, more manageable ES Modules for better maintainability.
*   [ ] **Improved Accessibility:** Conduct an a11y audit and improve keyboard navigation and screen reader support.

---

## License

This project is distributed under the MIT License. See `LICENSE` for more information.
