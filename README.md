# OpenMLauncher
A library that provides functions to manage your Minecraft game. With window app framework (e.g. Electron) might be more awesome!

## Installation
To Install, you just input the following command at the root of your Node.js project.

    npm i openmlauncher

## Environment Variables
`gameDir` - The directory that storage game files.

`configDir` - The directory that save OpenMLauncher configs.

## APIs
`oml.Game` - Download, install and launch any-version Minecraft.

`oml.Account` - Manage accounts that provides to log-in Minecraft.

`oml.Runtime` - Manage JRE [ get all runtimes that are installed, install specified JRE version that doesn't exist ] on your computer.

## Examples
We provides many functions to install and launch games in library.
### Get whole Minecraft versions

    import { oml } from 'openmlauncher';

    oml.Game.Vanilla.getAllVersions()

### Install specified version

    import { oml } from 'openmlauncher'

    oml.Game.Vanilla.Install(version)

The parameter `version` is the version which you'd like to install.

### Add an account to log-in Minecraft
Attention: Logging-in Microsoft account requires an Azure AD Application. Make sure you own your personal client_id.

From May 30th 2023 on, Mojang Studios requires 3rd-party Minecraft launcher to apply for access to get player profile. When you finished registering Azure AD Application, go to [Application Form](https://forms.cloud.microsoft/Pages/ResponsePage.aspx?id=v4j5cvGGr0GRqy180BHbR-ajEQ1td1ROpz00KtS8Gd5UNVpPTkVLNFVROVQxNkdRMEtXVjNQQjdXVC4u) to apply the access.

Before you use the following function, specifies one logging-in mode. We provides `AuthorizationMode.DeviceCode` and `AuthorizationMode.AuthorizationCode`

    import { oml, AuthorizationMode } from 'openmlauncher'

    oml.Account.add(method, client_id);


User data will be saved at `${configDir}/.oml/user.config` through encoding.

## Features
### Mods Support
[ This paragraph doesn't stands for ideas of Mojang Studios and Microsoft ]
* Add support for Mod loaders 
* Add manager for Mods
### Game Support
* Advanced Settings [ custom window size, auto enter server...... ]