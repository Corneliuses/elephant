import { mount } from 'svelte'
import App from './App.svelte'
import './app.css'

// Svelte 5 mounts with a function rather than `new App(...)`.
export default mount(App, { target: document.getElementById('app')! })
