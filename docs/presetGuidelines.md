# Preset Guidelines

One issue requests one Sunshine launch option for one host operating system. Submit another issue for a different store, emulator, core, or operating system. The bot generates a name from the game or app name, host OS, and game launch method.

## Games

Use the public IGDB game URL. The bot resolves its slug to a numeric IGDB ID and requires the same game and slug in GameDB. The catalog obtains the game cover from GameDB, so the form has no image field.

Choose the launch method that describes the command: Native, Steam, Epic Games, GOG, Microsoft Store, or Emulator. Microsoft Store is available on Windows only. An optional emulator variant can identify the console, launcher, or core when multiple emulator presets share an OS.

## Apps

Provide the official HTTPS homepage or source repository. An app image is optional and must be an HTTPS URL. App requests have no launch method or variant field; the generated name uses the app name and OS. App requests have no GameDB record and always require separate maintainer review.

## Commands and paths

Enter one command. PresetDB publishes it as Sunshine `cmd`. Sunshine's [application examples](https://github.com/LizardByte/Sunshine/blob/master/docs/app_examples.md) use detached commands for Steam launcher URIs, so submit a Steam executable command instead. Epic launcher URIs are supported for Windows Epic Games presets. A maintainer reviews other commands before approval.

The supported path placeholders are `{{ROM_PATH}}` and `{{HOME}}`. Windows also supports `{{SYSTEM_DRIVE}}`, `{{PROGRAM_FILES}}`, and `{{PROGRAM_FILES_X86}}`. Replace placeholders with paths on the Sunshine host before use. `{{ROM_PATH}}` is for emulator games. Literal user home paths and Windows reserved device names are rejected in Command and Working directory.

For replacements, enter the issue number displayed with the published preset and explain what changed. The original preset ID is retained.
