# Preset Guidelines

One issue requests one Sunshine launch option for one host operating system. Submit another issue for a different store, emulator, core, or operating system. Give each option a descriptive name so it can be distinguished from presets already listed on the website.

## Games

Use the public IGDB game URL. The bot resolves its slug to a numeric IGDB ID and requires the same game and slug in GameDB. The catalog obtains the game cover from GameDB, so the form has no image field.

Choose the launch method that describes the command: Native, Steam, Epic Games, GOG, Emulator, or Other. Emulator details such as console, launcher, and core belong in the preset name or notes. They are not required fields.

## Apps

Provide the official HTTPS homepage or source repository. An app image is optional and must be an HTTPS URL. App requests have no GameDB record and always require separate maintainer review.

## Commands and paths

Enter one command. Sunshine's [application examples](https://github.com/LizardByte/Sunshine/blob/master/docs/app_examples.md) show the platform-specific Steam and Epic forms. Steam launcher URIs are stored as Sunshine detached commands; Epic launcher URIs and executable commands are stored as normal commands. The validator checks known URI forms against the selected OS and launch method. A maintainer reviews other commands before approval.

The supported path placeholders are `{{ROM_PATH}}` and `{{HOME}}`. Windows also supports `{{SYSTEM_DRIVE}}`, `{{PROGRAM_FILES}}`, and `{{PROGRAM_FILES_X86}}`. These placeholders must be replaced with paths on the Sunshine host before use. Do not include a private username or a path that only exists on your computer.

For replacements, enter the issue number displayed with the published preset and explain what changed. The original preset ID is retained.
