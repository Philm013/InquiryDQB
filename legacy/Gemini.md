### **Role/Persona**

I am your Senior Software Engineer and Tech Lead. I will guide you through refactoring your application into a secure, scalable, and maintainable product, with a specific focus on optimizing it for hosting on GitHub Pages.

### **Context**

You have built the InquiryDQB Teacher Console and Student Remote applications. The goal is to evolve them from single-file prototypes into a professional project hosted on a public GitHub repository via GitHub Pages. This requires a modern build process that produces static assets compatible with this hosting environment and a workflow that automates deployment. We will use a Static Site Generator (SSG) configuration for this.

### **Task**

I will provide a comprehensive, four-phase roadmap specifically adapted for GitHub Pages. This plan will cover:
1.  **Phase 0: Project Setup for Static Site Generation:** Establishing a professional development environment optimized for static output.
2.  **Phase 1: Framework Migration (Svelte):** Rebuilding the UI layer with a component-based, reactive framework.
3.  **Phase 2: State Management & Decoupling:** Professionalizing data management and application logic.
4.  **Phase 3: Production Readiness & Deployment:** Implementing testing and an automated GitHub Actions workflow to deploy to your `gh-pages` branch.

### **Format & Constraints**

This plan follows the same format as before: a multi-phase implementation plan with specific, numbered steps containing an **Objective**, **Rationale**, **Action Items**, and **Examples**. The key constraint is that the final output must be a collection of static files (HTML, CSS, JS) that can be served directly by GitHub Pages without a server.

---

### **The GitHub Pages Refactoring Roadmap**

### **Phase 0: Project Setup for Static Site Generation**

**Objective:** Establish a modern development environment that compiles your application into a pure static website.

**Rationale:** GitHub Pages is a static host. It cannot run a Node.js server. We must use a build tool configured to output a `dist` folder containing only HTML, CSS, and JS files that the browser can run directly.

*   **Step 0.1: Version Control with Git**
    *   **Action:**
        1.  Create a new public repository on GitHub (e.g., `inquirydqb`).
        2.  Clone the empty repository to your local machine.
        3.  Initialize a `.gitignore` file. You can find standard templates online for "Node".
        4.  *This repository will be the home for your entire project.*

*   **Step 0.2: Initialize a Vite + Svelte Project (Non-SvelteKit)**
    *   **Action:**
        1.  In your local repository folder, run the command: `npm create vite@latest . -- --template svelte-ts`
            *   The `.` tells Vite to create the project in the current directory.
            *   We are choosing `svelte-ts` (the plain Svelte template), **not SvelteKit**. SvelteKit is a full-stack framework with server-side features we don't need for GitHub Pages, which simplifies our setup.
        2.  Run `npm install` to install dependencies.
        3.  Copy your legacy code into a `legacy` folder for reference.

*   **Step 0.3: Configure Vite for GitHub Pages**
    *   **Action:**
        1.  Open the `vite.config.ts` file.
        2.  You must set the `base` configuration option to your repository name. This is a **critical step** for assets (like CSS and JS files) to load correctly on GitHub Pages.

    *   **Example (`vite.config.ts`):**
        ```typescript
        import { defineConfig } from 'vite'
        import { svelte } from '@sveltejs/vite-plugin-svelte'

        // https://vitejs.dev/config/
        export default defineConfig({
          plugins: [svelte()],
          // CRITICAL: Set this to your repository name
          base: '/inquirydqb/', 
        })
        ```

*   **Step 0.4: Separate Teacher and Student Apps**
    *   **Action:**
        1.  In your `index.html` at the root of the project, create simple links to the two separate applications. This will be the landing page.
        2.  Create two new HTML files: `teacher.html` and `student.html`.
        3.  Create two entry points for your TypeScript: `src/teacher.ts` and `src/student.ts`.
        4.  Configure Vite to build both pages as separate outputs.

    *   **Example (`vite.config.ts` - Multi-page setup):**
        ```typescript
        import { defineConfig } from 'vite'
        import { svelte } from '@sveltejs/vite-plugin-svelte'
        import { resolve } from 'path'

        export default defineConfig({
          plugins: [svelte()],
          base: '/inquirydqb/',
          build: {
            rollupOptions: {
              input: {
                main: resolve(__dirname, 'index.html'),
                teacher: resolve(__dirname, 'teacher.html'),
                student: resolve(__dirname, 'student.html'),
              },
            },
          },
        })
        ```
    *   **Example (`teacher.html`):**
        ```html
        <!DOCTYPE html>
        <html>
          <head>...</head>
          <body>
            <div id="app-teacher"></div>
            <script type="module" src="/src/teacher.ts"></script>
          </body>
        </html>
        ```

### **Phase 1: Framework Migration (Svelte)**

**Objective:** Rebuild the UI layer using Svelte components. The process is identical to the previous plan, but your entry point is different.

**Rationale:** A reactive, component-based architecture is essential for managing the complexity of your UI.

*   **Step 1.1: Create Core Components**
    *   **Action:** Same as before. Create `.svelte` files for `Item.svelte`, `Toolbar.svelte`, `Sidebar.svelte`, etc., in a `src/lib/components/` folder.

*   **Step 1.2: Create the Root Application Components**
    *   **Action:**
        1.  Create `src/lib/TeacherApp.svelte` and `src/lib/StudentApp.svelte`.
        2.  These components will be the top-level containers for each application, holding the main layout and logic.
        3.  Your `teacher.ts` and `student.ts` files will now be very simple: they just mount these root components to the DOM.

    *   **Example (`src/teacher.ts`):**
        ```typescript
        import TeacherApp from './lib/TeacherApp.svelte';

        const app = new TeacherApp({
            target: document.getElementById('app-teacher'),
        });

        export default app;
        ```

*   **Step 1.3: Rebuild the Teacher View in `TeacherApp.svelte`**
    *   **Action:**
        1.  This Svelte component is where you'll implement the main UI from your old `index.html` body.
        2.  Use `{#each}` loops to render items, and import child components like `Toolbar` and `Sidebar`. This replaces your `Render` module.

### **Phase 2: State Management & Decoupling**

**Objective:** Eliminate global state and replace it with predictable Svelte stores.

**Rationale:** This is the core architectural improvement that will make your application robust and debuggable.

*   **Step 2.1: Create Svelte Stores**
    *   **Action:** Same as before. Create a `src/lib/stores/` folder and define your custom stores (e.g., `boardStore.ts`). Use TypeScript to define the shape of your store's data.

*   **Step 2.2: Refactor Logic to Use Stores**
    *   **Action:** Same as before. Go through all your business logic (actions, modes, network handlers) and replace direct state mutations with calls to your store's methods (e.g., `boardStore.addItem(newItem)`).

### **Phase 3: Production Readiness & Automated Deployment**

**Objective:** Implement a professional workflow that automatically tests and deploys your static application to GitHub Pages.

**Rationale:** Automation removes human error from the deployment process and ensures that only tested, working code goes live.

*   **Step 3.1: Implement Testing**
    *   **Action:**
        1.  Set up `Vitest` for unit testing your stores and business logic.
        2.  Set up `Playwright` for end-to-end testing your UI interactions.

*   **Step 3.2: Create the GitHub Actions Deployment Workflow**
    *   **Action:**
        1.  In your repository, create the folder `.github/workflows/`.
        2.  Inside, create a file named `deploy.yml`.
        3.  This file will define a series of jobs that GitHub will run automatically whenever you push code to your `main` branch.

    *   **Example (`.github/workflows/deploy.yml`):**
        ```yaml
        name: Deploy to GitHub Pages

        on:
          push:
            branches: [ main ] # Trigger on push to the main branch
          workflow_dispatch: # Allow manual triggering

        # Allow this job to clone the repo and create a page deployment
        permissions:
          contents: read
          pages: write
          id-token: write

        jobs:
          build:
            runs-on: ubuntu-latest
            steps:
              - name: Checkout your repository
                uses: actions/checkout@v3

              - name: Install Node.js
                uses: actions/setup-node@v3
                with:
                  node-version: 18

              - name: Install dependencies
                run: npm install

              - name: Build the project
                run: npm run build # This creates the 'dist' folder

              - name: Upload production-ready build files
                uses: actions/upload-pages-artifact@v1
                with:
                  path: ./dist

          deploy:
            needs: build
            runs-on: ubuntu-latest
            environment:
              name: github-pages
              url: ${{ steps.deployment.outputs.page_url }}
            steps:
              - name: Deploy to GitHub Pages
                id: deployment
                uses: actions/deploy-pages@v1
        ```

*   **Step 3.3: Configure GitHub Pages Settings**
    *   **Action:**
        1.  In your GitHub repository settings, go to the "Pages" section.
        2.  Under "Build and deployment", set the "Source" to **"GitHub Actions"**.
        3.  Now, every time you push a change to your `main` branch, the workflow will run. If it succeeds, it will build your static files and automatically deploy them. Your site will be live at `https://<your-username>.github.io/<your-repo-name>/`. The links to `teacher.html` and `student.html` will also work correctly because of the `base` and multi-page configuration you set up in Phase 0.