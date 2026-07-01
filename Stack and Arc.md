Cross-platform local desktop application.

Frontend:
* React
* TypeScript

Desktop shell:
* Tauri v2

Backend / Core:
* Rust

Data storage:
* local file system
* JSON files
* storage via the application directory (Tauri App Data Directory)


React
Service layer
Tauri 
Rust commands
File system



React:
* UI rendering
* screen state
* handling user actions

React must not:
* read files
* save data

Tauri:
* launching the application window
* communication between React and Rust
* access to system functions

Rust:
* Core backend

Storage:
* Storing notes
* Reading and writing JSON


DO NOT USE:
* REST API
* HTTP
* Cloud
* Accessing files from React
* Storing logic in the frontend

ALLOWED:
* React
* Tauri
* Rust
* File system
* JSON

Important!!!!!!!
React is responsible only for rendering, UI and frontend.
Rust manages all the data.
Tauri simply connects them.
