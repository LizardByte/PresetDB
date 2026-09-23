# Preset Guidelines

One issue requests one launch option. Native, GOG, and app commands target a chosen host OS. Store IDs generate commands for each supported launcher OS; emulator commands must be portable across hosts. Submit another issue for a different store, emulator, or core. The bot generates names from the game or app name and launch method, plus the host OS when selected.

## Games

Use the public IGDB game URL. The bot resolves its slug to a numeric IGDB ID and requires the same game and slug in GameDB. The catalog obtains the game cover from GameDB, so the form has no image field.

Choose the Native, Steam, Epic Games, GOG, Microsoft Store, or Emulator issue form. Only Native and GOG game forms ask for a host OS. Steam can generate Windows, Linux, and macOS commands; Epic Games can generate Windows and macOS commands; Microsoft Store can generate a Windows command. An optional emulator variant can identify a console, launcher, or core.

## Apps

Provide the official HTTPS homepage or source repository. An app image is optional and must be an HTTPS URL. App requests have no launch method or variant field; the generated name uses the app name and OS. App requests have no GameDB record and always require separate maintainer review.

## Commands and paths

Steam, Epic Games, and Microsoft Store forms each have one Launch ID field. Steam takes the numeric app ID from its store URL. Epic Games takes the three-part Sandbox ID, Catalog ID, and Artifact ID from the launcher shortcut, separated by colons or %3A. Microsoft Store takes the installed app [AUMID](https://learn.microsoft.com/en-us/windows/configuration/store/find-aumid) from Get-StartApps; a Store product ID cannot launch the installed game. The bot generates commands for each supported launcher OS. These are launcher capabilities; reviewers must check whether the game itself supports each platform.

Native, GOG, and Emulator forms require a Command. GOG games can launch without Galaxy, so no single GOG ID command is assumed. Emulator commands must work across host OSes, using executable names on the host PATH and portable path placeholders. A maintainer reviews manual commands before approval. Store launchers can exit before their game; Sunshine may keep the stream open until the user ends it. PresetDB stores generic command fields; the website can export a Sunshine application JSON object using `cmd`.

The supported path placeholders are ROM_PATH and HOME, written with double curly braces in the form. Windows Native, GOG, and app commands also support SYSTEM_DRIVE, PROGRAM_FILES, and PROGRAM_FILES_X86. Replace placeholders with paths on the host before use. ROM_PATH is for emulator games. Literal user home paths and Windows reserved device names are rejected in Command and Working directory.

Steam presets link to [ProtonDB](https://www.protondb.com/). The website shows the reported Linux compatibility tier when the Pages build can fetch one; no rating means unknown, not incompatible. Compatibility data comes from [ProtonDB contributors](https://github.com/bdefore/protondb-data) under the [Open Database License](https://opendatacommons.org/licenses/odbl/).

For replacements, enter the issue number displayed with the published preset and explain what changed. The original preset ID is retained.
