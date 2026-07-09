# Bundled spellcheck dictionaries (Phase 3 step 4)

Drop Hunspell dictionary pairs here to make a language available in the app:

```
en_US.aff
en_US.dic
```

The file **stem** is the language code the UI shows and stores in the
`spellcheck` app-setting (e.g. `en_US`). A language is "available" only when
**both** `<lang>.aff` and `<lang>.dic` are present. These files are bundled as
Tauri resources (see `bundle.resources` in `tauri.conf.json`) and resolved at
runtime from the app's resource directory by the `spellcheck_*` commands.

No dictionary is vendored in the repo yet (a licensing decision was deferred):
until a real `en_US` pair is added here, spellcheck is **inert** — `check`
returns no misspellings rather than flagging every word. Once you add the files,
`en_US` becomes available and is enabled by default.

Recommended source: a permissively-licensed `en_US` Hunspell dictionary such as
the SCOWL-derived set shipped by LibreOffice/Firefox. Keep the upstream license
file alongside these when you vendor them.
