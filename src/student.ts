// src/student.ts
import StudentApp from './lib/StudentApp.svelte';

const app = new StudentApp({
    target: document.getElementById('app-student'),
});

export default app;
