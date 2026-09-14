import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import GitSetup, { type GitAvailability } from './GitSetup';
import { invoke } from '@tauri-apps/api/core';
import { backend } from "./backend";
import "./styles.css";

const checkGit = () => invoke<GitAvailability>('check_git');
const installGit = () => invoke<string>('install_git');

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <GitSetup check={checkGit} install={installGit}><App backend={backend} /></GitSetup>
  </React.StrictMode>,
);
