# Preset Guidelines

One issue requests one Sunshine launch option for one host operating system. Submit another issue for a different store, emulator, core, or operating system. The bot generates a name from the game or app name, host OS, and game launch method.

## Games

Use the public IGDB game URL. The bot resolves its slug to a numeric IGDB ID and requires the same game and slug in GameDB. The catalog obtains the game cover from GameDB, so the form has no image field.

Choose Native, Steam, Epic Games, GOG, Microsoft Store, or Emulator. Steam accepts Windows, Linux, and macOS; Epic Games accepts Windows and macOS; Microsoft Store accepts Windows only. An optional emulator variant can identify the console, launcher, or core when multiple emulator presets share an OS.

## Apps

Provide the official HTTPS homepage or source repository. An app image is optional and must be an HTTPS URL. App requests have no launch method or variant field; the generated name uses the app name and OS. App requests have no GameDB record and always require separate maintainer review.

## Commands and paths

Use the single **Launch ID** field for Steam, Epic Games, or Microsoft Store. For Steam, enter the numeric app ID from a Steam store URL. For Epic Games, enter the three-part Sandbox ID, Catalog ID, and Artifact ID from the game's launcher shortcut, separated by colons or `%3A`. For Microsoft Store, enter the installed app's [AUMID](https://learn.microsoft.com/en-us/windows/configuration/store/find-aumid), available through `Get-StartApps`; a Store product ID opens a store page and cannot launch the installed game. Leave Command and Working directory blank for these methods. The bot generates the OS-specific Sunshine `cmd` and stores the launch ID with the preset.

For Native, GOG, and Emulator, provide one Command. GOG games can launch without Galaxy, so no single GOG ID command is assumed. A maintainer reviews these commands before approval. Store launchers can exit before their game; Sunshine may keep the stream open until the user ends it. PresetDB uses only Sunshine `cmd`, with no detached command field.

The supported path placeholders are `{{ROM_PATH}}` and `{{HOME}}`. Windows also supports `{{SYSTEM_DRIVE}}`, `{{PROGRAM_FILES}}`, and `{{PROGRAM_FILES_X86}}`. Replace placeholders with paths on the Sunshine host before use. `{{ROM_PATH}}` is for emulator games. Literal user home paths and Windows reserved device names are rejected in Command and Working directory.

For replacements, enter the issue number displayed with the published preset and explain what changed. The original preset ID is retained.
