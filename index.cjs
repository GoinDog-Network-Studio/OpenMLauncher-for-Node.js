const download = require('download-file');
const { arch, platform, release } = require('os');
const path = require('path');
const { basename, dirname } = path;
const {
  realpathSync,
  writeFileSync,
  readFileSync,
  existsSync,
  mkdirSync,
  writeFile,
  copyFileSync,
  rmSync,
  readdirSync
} = require('fs');
const clipboard = require('clipboardy');
const { exec, execSync, spawn } = require('child_process');
const AdmZip = require('adm-zip');
const request = require('sync-request');
const { Buffer } = require('buffer');
const readline = require('readline');
const { promisify } = require('util');
function open(url) {
  let command;
  const platform = process.platform;

  if (platform === 'win32') {
    command = `start "" "${url}"`;
  } else if (platform === 'darwin') {
    command = `open "${url}"`;
  } else if (platform === 'linux') {
    command = `xdg-open "${url}"`;
  } else {
    throw new Error(`Unsupported platform: ${platform}`);
  }

  exec(command);
}
const getManifest = () => {
    const vanilla_versions = JSON.parse(request("GET", "https://piston-meta.mojang.com/mc/game/version_manifest.json").getBody());

    // Verify ModLoader Support Situation
    const supported_fabric_versions = JSON.parse(request("GET", "https://meta.fabricmc.net/v2/versions/game").getBody());
    const supported_forge_versions = JSON.parse(request("GET", "https://bmclapi2.bangbang93.com/forge/minecraft").getBody());
    function getFirstTwoVersionNumbers(versionString) {
        let splitVersion = versionString.split('.');
        return `${splitVersion[0]}.${splitVersion[1]}`;
    }
    function getMcVersionFromNeoForgeVersion(versionString) {
        const spl = versionString.split('.');
        // Handle the new versioning scheme first
        if (parseInt(spl[0]) >= 26) {
            // 26.1.0.X -> 26.1
            var mcVersion = spl[0] + '.' + spl[1];
            // 26.1.1.X -> 26.1.1
            if (spl[2] != '0') {
                mcVersion += '.' + spl[2];
            }

            // 26.1.0.0-alpha+snapshot-1
            const splitBySnapshotIdentifier = versionString.split('+');
            if (splitBySnapshotIdentifier.length == 2) {
                mcVersion += '-' + splitBySnapshotIdentifier[1];
            }
            return mcVersion;
        }
        return "1." + getFirstTwoVersionNumbers(versionString);
    }
    const supported_neoforged_version = JSON.parse(request("GET", "https://maven.neoforged.net/api/maven/versions/releases/net/neoforged/neoforge").getBody())['versions'].map(v => getMcVersionFromNeoForgeVersion(v));
    const supported_liteloader_version = Object.keys(
        JSON.parse(request("GET", "https://chinanet.mirrors.ustc.edu.cn/bmclapi/com/mumfrey/liteloader/versions.json").getBody())['versions']
    )
    const supported_optfine_version = JSON.parse(request("GET", "https://bmclapi2.bangbang93.com/optifine/versionList").getBody()).map(e => e.mcversion)
    let versions_list = vanilla_versions['versions'];
    versions_list = versions_list.map((v) => {
        return {
            ...v,
            modloaders: {
                Forge: (supported_forge_versions.indexOf(v.id) != -1),
                Fabric: (supported_fabric_versions.filter(v_ => v_.version == v.id).length != 0),
                NeoForge: (supported_neoforged_version.indexOf(v.id) != -1),
                LiteLoader: (supported_liteloader_version.indexOf(v.id) != -1),
                Optifine: (supported_optfine_version.indexOf(v.id) != -1)
            }
        }
    })
    vanilla_versions['versions'] = versions_list;
    return vanilla_versions;
}
const thr_count = 32;
const utils = {
    getVersionInfo(ver) {
        const pkg = getManifest()['versions'].find(v => v.id == ver)["url"];
        return JSON.parse(request("GET", pkg).getBody());
    },
    getAssetsManifest(ver) {
        const versionInfo = utils.getVersionInfo(ver);
        const url = versionInfo['assetIndex']['url'];
        return JSON.parse(request('GET', url).getBody());
    },
    rulesAnalyzer: (rules = []) => {
        let result = {
            "linux-": false,
            'macos-x64': false,
            'macos-arm64': false,
            'windows-x64': false,
            'windows-x86': false,
            'windows-arm64': false
        }
        rules.forEach(rule => {
            const action = rule['action'];
            const os = rule['os'] || undefined;
            const result_keys = Object.keys(result)
            if (os && Object.keys(rule).indexOf("features") == -1 && os.name) {
                const name = os.name == 'osx' ? 'macos' : os.name;
                result_keys.filter(key => key.indexOf(name) != -1 || key.indexOf(os.arch) != -1).forEach(k => {
                    result[k] = (action == "allow")
                })
                if (os.versionRange) {
                    const keys = Object.keys(os.versionRange);
                    const current_system_version = release().split(".")
                    const require_system_version = os.versionRange[keys[0]].split(".")
                    switch (keys[0]) {
                        case "min":
                            for (let i = 0; i < current_system_version.length; i++) {
                                const current = Number.parseInt(current_system_version[i]);
                                const required = Number.parseInt(require_system_version[i])
                                if (current > required) {
                                    result[`${getSystemName()}-${getSystemName() == 'linux' ? '' : getArch()}`] == true
                                }
                                else if (current == required) {
                                    if (i == current_system_version - 1) {
                                        result[`${getSystemName()}-${getSystemName() == 'linux' ? '' : getArch()}`] == true;
                                        break;
                                    }
                                    continue;
                                } else {
                                    result[`${getSystemName()}-${getSystemName() == 'linux' ? '' : getArch()}`] == false
                                    break;
                                }
                            }
                            break;
                        case "max":
                            for (let i = 0; i < current_system_version.length; i++) {
                                const current = Number.parseInt(current_system_version[i]);
                                const required = Number.parseInt(require_system_version[i])
                                if (current < required) {
                                    result[`${getSystemName()}-${getSystemName() == 'linux' ? '' : getArch()}`] == true
                                }
                                else if (current == required) {
                                    if (i == current_system_version - 1) {
                                        result[`${getSystemName()}-${getSystemName() == 'linux' ? '' : getArch()}`] == false;
                                        break;
                                    }
                                    continue;
                                } else {
                                    result[`${getSystemName()}-${getSystemName() == 'linux' ? '' : getArch()}`] == false
                                    break;
                                }
                            }
                            break;

                        default:
                            break;
                    }
                }
            } else {
                result_keys.forEach(k => {
                    result[k] = (action == "allow")
                })
            }
        })
        return result;
    },
    AnalyzeLibrary: function (lib) {
        let os_config = {};
        var res = {};
        const ifIsNative = function () {
            if (lib['name'] == "org.lwjgl.lwjgl:lwjgl-platform:2.9.2-nightly-20140822") {
                console.log(res, lib['downloads'])
            }
            if (Object.keys(lib).indexOf("natives") != -1) {
                if (Object.keys(lib['natives']).indexOf(getSystem()) != -1) {
                    if (lib['natives'][getSystem()].indexOf("${arch}") != -1) {
                        res = {
                            ...lib['downloads']['artifact'] || {}, native: Object.keys(lib['downloads']['classifiers']).indexOf(`natives-${getSystem()}-${getArch().replace("x", "")}`) == -1 ? {} : lib['downloads']['classifiers'][`natives-${getSystem()}-${getArch().replace("x", "")}`]
                        }
                        res['isNative'] = true
                    } else {
                        res = {
                            ...lib['downloads']['artifact'], native: lib['downloads']['classifiers'][`natives-${getSystem()}`]
                        }
                        res['isNative'] = true;
                    }
                }
            } else if (lib['name'].indexOf("natives") != -1) {
                const names = lib['name'].split(":");
                if (os_config[`${getSystemName()}-${getSystemName() == 'linux' ? '' : getArch()}`] && names[names.length - 1] == `natives-${getSystemName()}${getArch() == 'x64' ? '' : `-${getArch()}`}`) {
                    res = lib['downloads']['artifact'];
                    res['isNative'] = true;
                }
            } else {
                res = lib['downloads']['artifact'];
                res['isNative'] = false;
            }
        }
        if (Object.keys(lib).indexOf("rules") != -1) {
            os_config = this.rulesAnalyzer(lib['rules']);
            if (os_config[`${getSystemName()}-${getArch()}`]) {
                ifIsNative()
            }
        } else {
            ifIsNative()
        }
        return res;
    }
}
let logs = [];
const log = {
    info: (msg) => {
        const context = `[INFO/${new Date().getTime()}] ${msg}`
        console.log(context);
        logs.push(context)
    },
    warn: (msg) => {
        const context = `[WARN/${new Date().getTime()}] ${msg}`
        console.warn(context);
        logs.push(context)
    },
    error: (msg) => {
        const context = `[ERROR/${new Date().getTime()}] ${msg}`
        console.error(context);
        logs.push(context)
    }
}
const getSystem = () => {
    return platform() === 'win32' ? 'windows' : platform() === 'darwin' ? 'osx' : platform() === 'linux' ? 'linux' : 'unknown';
}
const getSystemName = () => {
    return platform() === 'win32' ? 'windows' : platform() === 'darwin' ? 'macos' : platform() === 'linux' ? 'linux' : 'unknown';
}
const getArch = () => {
    return arch() === 'x64' ? "x64" : arch() === 'ia32' ? 'x86' : arch() === 'arm64' ? 'arm64' : 'unknown';
}
class User {
    constructor(ms_profile, mc_profile) {
        if (ms_profile != null && mc_profile != null) {
            const encoded_ms_profile = {
                access_token: Buffer.from(ms_profile.access_token).toString('base64'),
                refresh_token: Buffer.from(ms_profile.refresh_token).toString('base64')
            }
            this.ms_profile = encoded_ms_profile;
            this.mc_profile = mc_profile;
        }
    }
    setMicrosoftProfile(ms_profile) {
        const encoded_ms_profile = {
            access_token: Buffer.from(ms_profile.access_token).toString('base64'),
            refresh_token: Buffer.from(ms_profile.refresh_token).toString('base64')
        }
        this.ms_profile = encoded_ms_profile;
    }
    setMinecraftProfile(mc_profile) {
        this.mc_profile = mc_profile;
    }
    toJSON() {
        return {
            ms_profile: this.ms_profile,
            mc_profile: this.mc_profile
        }
    }
}
const oml = {
    Core: {
        version: "v1.0.0",
        logs: () => {
            return logs.join("\n");
        }
    },
    Game: {
        Vanilla: {
            getAllVersions: function () {
                return getManifest()['versions'];
            },
            Install: (version, name = version) => {
                log.info(`Installing Minecraft ${version} to ${oml.Direction.gameDir}...`);
                const info = utils.getVersionInfo(version);
                // Download Client JAR File
                const client_url = info['downloads']['client']['url'];
                const ver_dir = `${oml.Direction.gameDir}/versions/${name}/`;
                if (!existsSync(ver_dir)) {
                    mkdirSync(ver_dir, { recursive: true })
                }

                log.info("Downloading Minecraft client JAR file.")
                writeFileSync(`${ver_dir}/${name}.jar`, request("GET", client_url).getBody())
                // Download assets
                const assets_dir = `${oml.Direction.gameDir}/assets/`;
                const objects = utils.getAssetsManifest(version)['objects'];
                writeFileSync(`${assets_dir}/indexes/${version}.json`, JSON.stringify(utils.getAssetsManifest(version), null, 2));

                let keys = Object.keys(objects);
                let len = keys.length;
                let mod = len % thr_count;
                let per_thread = (len - mod) / thr_count;
                var start_point = 0
                var end_point = per_thread + 1;
                var finished_threads = 0;
                for (let th_i = 0; th_i < thr_count; th_i++) {
                    new Promise((resolve, reject) => {
                        for (let i = start_point; i < end_point; i++) {
                            const asset = objects[keys[i]];
                            const file_url = `https://resources.download.minecraft.net/${asset['hash'].slice(0, 2)}/${asset['hash']}`;
                            const file_path = `${assets_dir}/objects/${asset['hash'].slice(0, 2)}/`;
                            log.info(`Downloading asset ${keys[i]}...`);
                            download(file_url, {
                                directory: file_path,
                                filename: asset['hash']
                            }, () => {
                                resolve()
                            });
                        }
                    }).then(() => {
                        finished_threads++;
                    });
                    start_point = end_point;
                    end_point = start_point + (th_i < mod ? per_thread + 1 : per_thread);
                    if (end_point >= len) {
                        end_point = len;
                    }
                }
                log.info("Downloaded the whole assets.")
                // Download libraries
                const libraries = info['libraries'];
                let natives = []
                keys = Object.keys(libraries);
                len = keys.length;
                mod = len % thr_count;
                per_thread = (len - mod) / thr_count;
                start_point = 0
                end_point = per_thread + 1;
                for (let th_i = 0; th_i < thr_count; th_i++) {
                    new Promise((resolve, reject) => {
                        for (let i = start_point; i < end_point; i++) {
                            const library = libraries[i];
                            const analyzedData = utils.AnalyzeLibrary(library) || undefined;
                            if (analyzedData && Object.keys(analyzedData) != 0) {
                                if (analyzedData['isNative']) {
                                    const native_path = Object.keys(analyzedData).indexOf("native") == -1 ? analyzedData['path'] : analyzedData['native']['path'];
                                    const native_whole_path = `${oml.Direction.gameDir}/libraries/${native_path}`
                                    const native_url = Object.keys(analyzedData).indexOf("native") == -1 ? analyzedData['url'] : analyzedData['native']['url'];
                                    download(native_url, {
                                        directory: path.dirname(native_whole_path),
                                        filename: path.basename(native_whole_path)
                                    })
                                    natives.push(native_whole_path);
                                }
                                if (Object.keys(analyzedData).length != 2) {
                                    const lib_url = analyzedData['url'];
                                    const lib_path = `${oml.Direction.gameDir}/libraries/${analyzedData['path']}`
                                    log.info("Downloading library " + analyzedData['path'])
                                    download(lib_url, {
                                        directory: path.dirname(lib_path),
                                        filename: path.basename(lib_path)
                                    }, () => {
                                        resolve();
                                    })
                                }
                            } else {
                                continue;
                            }
                        }
                    }).then(() => {
                        finished_threads++;
                    });

                    start_point = end_point;
                    end_point = start_point + (th_i < mod ? per_thread + 1 : per_thread);
                    if (end_point >= len) {
                        end_point = len;
                    }
                }
                info['natives'] = natives;
                // Write version JSON file
                log.info("Writing Version JSON File.")
                writeFileSync(`${ver_dir}/${name}.json`, JSON.stringify(info, null, 2));
            }
        },
        Forge: {
            getForgeVersions: (minecraftVersion) => {
                return JSON.parse(
                    request("GET", "https://bmclapi2.bangbang93.com/forge/minecraft/" + minecraftVersion).getBody()
                )
            },
            Install: (name, minecraft_version, forge_version) => {
                oml.Game.Vanilla.Install(minecraft_version, name);
                const v = minecraft_version.split(".");
                const installer_jar_path = `${oml.Direction.configDir}/temp/forge-${name}/${name}-installer.jar`;
                const old_version_install = () => {
                    const mergeJSON = (source, target) => {
                        log.info("Merging version JSON file.")
                        let res = source;
                        let forge_libs = []
                        target['libraries'].forEach(lib => {
                            const name_list = lib['name'].split(":");
                            if (lib['url'] == undefined) lib['url'] = "https://libraries.minecraft.net/"
                            lib['url'] += `/${name_list[0].split(".").join("/")}/${name_list[1]}/${name_list[2]}/${name_list[1]}-${name_list[2]}.jar`;
                            lib['path'] = `/${name_list[0].split(".").join("/")}/${name_list[1]}/${name_list[2]}/${name_list[1]}-${name_list[2]}.jar`;
                            const forge_lib = {
                                downloads: {
                                    artifact: lib
                                },
                                name: lib['name']
                            }

                            const same_items = res['libraries'].filter(lib_ => {
                                const current = lib['name'].split(":");
                                const each = lib_['name'].split(":");

                                return (current[0] == each[0]) && (current[1] == each[1])
                            });
                            same_items.push(lib)
                            if (same_items.length >= 2) {
                                const versions_with_lower_num = same_items.sort(lib_ => {
                                    const current = lib['name'].split(":")[2].split(".");
                                    const each = lib_['name'].split(":")[2].split(".");
                                    const compareVersions = (a = [], b = []) => {
                                        const res = ((x, y) => {
                                            let z = []
                                            for (let i = 0; i < x.length; i++) {
                                                z.push(y[i] - x[i])
                                            }
                                            return z;
                                        })(a, b)

                                        let num = 0;
                                        res.forEach(v => {
                                            if (v > 0 || v < 0) {
                                                num = v;
                                                return;
                                            }
                                        })
                                        return num;
                                    }

                                    return compareVersions(current, each);
                                })
                                res['libraries'] = res['libraries'].filter(l => l.name != versions_with_lower_num[0].name)
                                res['libraries'].push({
                                    downloads: {
                                        artifact: versions_with_lower_num[1]
                                    },
                                    name: versions_with_lower_num[1].name
                                })
                                forge_libs.push({
                                    downloads: {
                                        artifact: versions_with_lower_num[1]
                                    },
                                    name: versions_with_lower_num[1].name
                                })
                            } else {
                                res['libraries'].push(forge_lib)
                                forge_libs.push(forge_lib)
                            }
                        });
                        res['minecraftArguments'] = target['minecraftArguments'];
                        res['mainClass'] = target['mainClass'];
                        res['clientVersion'] = target['inheritsFrom'];
                        res['id'] = target['id'];
                        return {
                            mergedJson: res,
                            forge_libs: forge_libs
                        };
                    }
                    const unzip_directory = `${oml.Direction.configDir}/temp/forge-${name}`;
                    const zip = new AdmZip(installer_jar_path);
                    zip.extractAllTo(unzip_directory, true);

                    const install_profile = JSON.parse(readFileSync(unzip_directory + "/install_profile.json"))
                    const forge_json = install_profile['versionInfo']
                    const merged_json = mergeJSON(
                        JSON.parse(
                            readFileSync(`${oml.Direction.gameDir}/versions/${name}/${name}.json`)
                        ),
                        forge_json
                    )
                    writeFileSync(`${oml.Direction.gameDir}/versions/${name}/${name}.json`, JSON.stringify(merged_json['mergedJson']))

                    // Download Forge Dependencies
                    for (let i = 0; i < merged_json['forge_libs'].length; i++) {
                        const lib = merged_json['forge_libs'][i];
                        const artifact = lib['downloads']['artifact'];
                        const lib_path = `${oml.Direction.gameDir}/libraries/`;
                        log.info(`Downloading Forge library: ${lib['name']}`)
                        if (lib['name'] == `net.minecraftforge:forge:${minecraft_version}-${forge_version}`) {
                            const destDir = dirname(lib_path.concat(artifact['path']));
                            if (!existsSync(destDir)) mkdirSync(destDir, { recursive: true })
                            copyFileSync(unzip_directory.concat(`/${install_profile['install'].filePath}`), lib_path.concat(artifact['path']));
                            continue;
                        }
                        const native_path = lib_path.concat(artifact['path'])
                        download(artifact['url'], {
                            directory: dirname(native_path),
                            filename: basename(native_path)
                        }, () => {
                            if (i == merged_json['forge_libs'].length - 1) {
                                rmSync(unzip_directory, { recursive: true })
                            }
                        });
                    }
                }
                const new_version_install = () => {
                    const installer_path = `${oml.Direction.configDir}/temp/forge-${name}/${name}-installer.jar`;
                    new AdmZip(installer_path).extractAllTo(`${oml.Direction.configDir}/temp/forge-${name}/`);

                    // Simulate official installer
                    const install_profile = JSON.parse(readFileSync(`${oml.Direction.configDir}/temp/forge-${name}/install_profile.json`))
                    // Step 1: Install neccesary libraries that are required by processors.
                    const tmp_lib_root = `${oml.Direction.gameDir}/libraries/`;
                    install_profile['libraries'].forEach(lib => {
                        const relative_path = lib['downloads']['artifact']['path']
                        const url = lib['downloads']['artifact']['url']
                        const absolute_path = path.join(tmp_lib_root, relative_path)
                        if (!existsSync(dirname(absolute_path))) {
                            mkdirSync(dirname(absolute_path), { recursive: true })
                        }
                        log.info("Downloading Forge installer required library: " + relative_path)
                        writeFileSync(absolute_path, request("GET", url).getBody())
                    })
                    // Step 2: Download and analyze data.
                    function getRelativePath(coordinate) {
                        const parts = coordinate.split(':');
                        if (parts.length < 3) {
                            throw new Error(`Unavailable path name: ${coordinate}`);
                        }

                        const groupId = parts[0];
                        const artifactId = parts[1];
                        let version = parts[2];
                        let classifier = null;
                        let extension = 'jar';

                        if (version.includes('@')) {
                            const [v, ext] = version.split('@');
                            version = v;
                            if (ext) extension = ext;
                        }

                        if (parts.length >= 4) {
                            classifier = parts.slice(3).join(':');
                            if (classifier.includes('@')) {
                                const [c, ext] = classifier.split('@');
                                classifier = c;
                                if (ext) extension = ext;
                            }
                        }

                        const groupPath = groupId.replace(/\./g, '/');
                        const fileName = `${artifactId}-${version}${classifier ? '-' + classifier : ''}.${extension}`;
                        return `${groupPath}/${artifactId}/${version}/${fileName}`;
                    }
                    const data = install_profile['data'];
                    const game_lib_root = `${oml.Direction.gameDir}/libraries/`
                    for (let i = 0; i < Object.keys(data).length; i++) {
                        const key = Object.keys(data)[i];
                        if (key == "BINPATCH") {
                            data[key]['client'] = path.join(
                                `${oml.Direction.configDir}/temp/forge-${name}/`,
                                data[key]['client']
                            )
                        }
                        data[key]['client'] = data[key]['client'].replaceAll(/\[([^}]+)\]/g, (match, pkg) => {
                            const absolute_path = path.join(game_lib_root, getRelativePath(pkg))
                            return absolute_path;
                        })
                    }
                    install_profile['data']['MINECRAFT_JAR'] = {
                        client: `${oml.Direction.gameDir}/versions/${name}/${name}.jar`
                    };
                    install_profile['data']['SIDE'] = {
                        client: "client"
                    }
                    // Step 3: Run processors.
                    const processors = install_profile['processors'];
                    const commands = [];
                    const add_command = (processor_config) => {
                        if (Object.keys(processor_config).indexOf("sides") == -1 || processor_config['sides'].indexOf("client") != -1) {
                            const getAbsolutePathFromName = (name) => {
                                return path.join(
                                    tmp_lib_root,
                                    install_profile['libraries'].filter(l => l['name'] == name)[0]['downloads']['artifact']['path']
                                );
                            }
                            const absolute_jar_path = getAbsolutePathFromName(processor_config['jar']);
                            const classpath = processor_config['classpath'].map(cp => {
                                const absolute = getAbsolutePathFromName(cp);
                                return `"${absolute}"`
                            }).join(getSystem() == 'windows' ? ";" : ":");
                            const args_ = processor_config['args'].map(arg => {
                                if (arg.indexOf("{") != -1) {
                                    return arg.replaceAll(/\{([^}]+)\}/g, (match, key) => {
                                        return install_profile['data'][key.toUpperCase()]['client']
                                    })
                                } else if (arg.indexOf("[") != -1) {
                                    return arg.replaceAll(/\[([^}]+)\]/g, (match, key) => {
                                        return path.join(tmp_lib_root, getRelativePath(key))
                                    })
                                }
                                return arg;
                            }).join(" ");
                            const mainClass = new AdmZip(absolute_jar_path).getEntry('META-INF/MANIFEST.MF').getData().toString("utf-8").match(/Main-Class:\s*(.+)/)[1].trim();
                            commands.push(`java -cp ${classpath}${getSystem() == "windows" ? ";" : ':'}${absolute_jar_path} ${mainClass} ${args_}`);
                        }
                    }
                    processors.forEach(processor => {
                        add_command(processor);
                    })
                    commands.forEach(cmd => {
                        log.info("Running Forge processor: " + cmd)
                        execSync(cmd);
                    })
                    // Step 4: Merge JSON file.
                    const forge_version_json = JSON.parse(
                        readFileSync(
                            path.join(
                                `${oml.Direction.configDir}/temp/forge-${name}/`,
                                install_profile['json']
                            )
                        )
                    );
                    const vanilla_json = JSON.parse(
                        readFileSync(`${oml.Direction.gameDir}/versions/${name}/${name}.json`)
                    );
                    const mergeJSON = (source, target) => {
                        log.info("Merging version JSON file.")
                        let res = source;
                        let forge_libs = []
                        target['libraries'].forEach(lib => {
                            const forge_lib = lib

                            const same_items = res['libraries'].filter(lib_ => {
                                const current = lib['name'].split(":");
                                const each = lib_['name'].split(":");

                                return (current[0] == each[0]) && (current[1] == each[1])
                            });
                            same_items.push(lib)
                            if (same_items.length >= 2) {
                                const versions_with_lower_num = same_items.sort(lib_ => {
                                    const current = lib['name'].split(":")[2].split(".");
                                    const each = lib_['name'].split(":")[2].split(".");
                                    const compareVersions = (a = [], b = []) => {
                                        const res = ((x, y) => {
                                            let z = []
                                            for (let i = 0; i < x.length; i++) {
                                                z.push(y[i] - x[i])
                                            }
                                            return z;
                                        })(a, b)

                                        let num = 0;
                                        res.forEach(v => {
                                            if (v > 0 || v < 0) {
                                                num = v;
                                                return;
                                            }
                                        })
                                        return num;
                                    }

                                    return compareVersions(current, each);
                                })
                                res['libraries'] = res['libraries'].filter(l => l.name != versions_with_lower_num[0].name)
                                res['libraries'].push({
                                    downloads: {
                                        artifact: versions_with_lower_num[1]
                                    },
                                    name: versions_with_lower_num[1].name
                                })
                                forge_libs.push({
                                    downloads: {
                                        artifact: versions_with_lower_num[1]
                                    },
                                    name: versions_with_lower_num[1].name
                                })
                            } else {
                                res['libraries'].push(forge_lib)
                                forge_libs.push(forge_lib)
                            }
                        });
                        res['arguments']['game'] = res['arguments']['game'].concat(target['arguments']['game'])
                        res['arguments']['jvm'] = res['arguments']['jvm'].concat(target['arguments']['jvm'])
                        res['mainClass'] = target['mainClass'];
                        res['clientVersion'] = target['inheritsFrom'];
                        res['id'] = target['id'];
                        return {
                            mergedJson: res,
                            forge_libs: forge_libs
                        };
                    }
                    const merged_json = mergeJSON(vanilla_json, forge_version_json)
                    writeFileSync(`${oml.Direction.gameDir}/versions/${name}/${name}.json`, JSON.stringify(merged_json['mergedJson']));

                    // Step 5: Install Forge loader required library.
                    const forge_libs = merged_json['forge_libs'];
                    forge_libs.forEach(lib => {
                        const relative_path = lib['downloads']['artifact']['path']
                        const url = lib['downloads']['artifact']['url'];
                        log.info("Downloading Forge Loader libraries: " + relative_path)
                        if (request("GET", url).statusCode == 200) {
                            writeFileSync(
                                path.join(game_lib_root, relative_path),
                                request("GET", url).getBody()
                            )
                        } else {
                            log.error("Failed to download library " + relative_path + ": " + request("GET", url).statusCode)
                        }
                    })

                    // Step 6: Clear temp files.
                    rmSync(`${oml.Direction.configDir}/temp/forge-${name}/`, { recursive: true })
                }
                const minecraft_version_thr_dot = ((v = "") => {
                    const list = v.split(".");
                    if (list.length == 3) {
                        return v;
                    }
                    list.push("0");
                    return list.join(".");
                })(minecraft_version)
                const installer_url = [
                    `https://maven.minecraftforge.net/net/minecraftforge/forge/${minecraft_version}-${forge_version}/forge-${minecraft_version}-${forge_version}-installer.jar`,
                    `https://maven.minecraftforge.net/net/minecraftforge/forge/${minecraft_version}-${forge_version}-${minecraft_version_thr_dot}/forge-${minecraft_version}-${forge_version}-${minecraft_version_thr_dot}-installer.jar`,
                ];
                let final_installer_url = "";
                // Check which URL is available.
                final_installer_url = request("GET", installer_url[0]).statusCode == 200 ? installer_url[0] : installer_url[1];
                mkdirSync(`${oml.Direction.configDir}/temp/forge-${name}/`, { recursive: true })
                log.info("Downloading Forge installer JAR file.")
                download(final_installer_url, {
                    directory: `${oml.Direction.configDir}/temp/forge-${name}/`,
                    filename: `${name}-installer.jar`
                }, (err, a) => {
                    if (err) {
                        log.error(err)
                        return;
                    }
                    if (v[0] == '1' && Number.parseInt(v[1]) < 13) {
                        old_version_install()
                    } else {
                        new_version_install()
                    }
                })
            }
        },
        Fabric: {
            getFabricLoaderVersions: () => {
                return JSON.parse(request("GET", "https://meta.fabricmc.net/v2/versions/loader").getBody())
            },
            Install: (name, minecraft_version, fabric_version) => {
                oml.Game.Vanilla.Install(minecraft_version, name);
                let fabric_manifest = JSON.parse(
                    request("GET", "https://meta.fabricmc.net/v2/versions/loader/" + minecraft_version).getBody()
                ).filter(v => v.loader.version == fabric_version)[0];

                // Merge JSON file
                let mc_manifest = JSON.parse(readFileSync(oml.Direction.gameDir + "/versions/" + name + "/" + name + ".json"));
                fabric_manifest['loader']['url'] = "https://maven.fabricmc.net/";
                fabric_manifest['intermediary']['url'] = "https://maven.fabricmc.net/";
                fabric_manifest['libraries'] = fabric_manifest['launcherMeta']['libraries'];
                fabric_manifest['loader']['name'] = fabric_manifest['loader']['maven'];
                fabric_manifest['intermediary']['name'] = fabric_manifest['intermediary']['maven'];
                fabric_manifest['libraries']['common'].push(fabric_manifest['loader'])
                fabric_manifest['libraries']['common'].push(fabric_manifest['intermediary']);

                const fabric_libraries = fabric_manifest['libraries']['common'].map(lib => {
                    const pkg = lib['name'].split(":");
                    lib['url'] += `/${pkg[0].replaceAll(".", "/")}/${pkg[1]}/${pkg[2]}/${pkg[1]}-${pkg[2]}.jar`
                    lib['path'] = `/${pkg[0].replaceAll(".", "/")}/${pkg[1]}/${pkg[2]}/${pkg[1]}-${pkg[2]}.jar`;
                    const obj = {
                        downloads: {
                            artifact: lib
                        },
                        name: lib['name']
                    }
                    mc_manifest['libraries'].push(obj)
                    return obj;
                })

                fabric_libraries.forEach(fabric_lib => {
                    const name_list_of_fabric_lib = fabric_lib['downloads']['artifact']['name'].split(":");
                    const repeated_mc_libs = mc_manifest['libraries'].filter(mc_lib => {
                        const name_list_of_mc_lib = mc_lib['name'].split(":");
                        return (name_list_of_mc_lib[0] == name_list_of_fabric_lib[0]) && (name_list_of_mc_lib[1] == name_list_of_fabric_lib[1])
                    })
                    if (repeated_mc_libs.length > 0) {
                        let repeated_libs = [
                            repeated_mc_libs[0],
                            fabric_lib
                        ]
                        const repeated_libs_with_version = repeated_libs.sort((m, n) => {
                            const compareVersions = (a = [], b = []) => {
                                const res = ((x, y) => {
                                    let z = []
                                    for (let i = 0; i < x.length; i++) {
                                        z.push(y[i] - x[i])
                                    }
                                    return z;
                                })(a, b)

                                let num = 0;
                                res.forEach(v => {
                                    if (v > 0 || v < 0) {
                                        num = v;
                                        return;
                                    }
                                })
                                return num;
                            }
                            const m_versions = m['downloads']['artifact']['name'].split(":")[2].split(".");
                            const n_versions = n['downloads']['artifact']['name'].split(":")[2].split(".");

                            return compareVersions(m_versions, n_versions)
                        })
                        mc_manifest['libraries'] = mc_manifest['libraries'].filter(l => l['downloads']['artifact']['name'] != repeated_libs_with_version[0]['downloads']['artifact']['name']);
                        mc_manifest['libraries'].push(repeated_libs_with_version[1]);
                    }
                });
                mc_manifest['mainClass'] = fabric_manifest['launcherMeta']['mainClass']['client'];

                writeFileSync(oml.Direction.gameDir + "/versions/" + name + "/" + name + ".json", JSON.stringify(mc_manifest));

                //Download fabric libraries
                fabric_libraries.forEach(lib => {
                    const pkg = lib['name'].split(":");
                    const url = lib['downloads']['artifact']['url'];
                    const path_ = oml.Direction.gameDir + `/libraries/${pkg[0].replaceAll(".", "/")}/${pkg[1]}/${pkg[2]}/${pkg[1]}-${pkg[2]}.jar`;
                    log.info("Downloading Fabric library " + lib['name'])
                    download(url, {
                        directory: path.dirname(path_),
                        filename: path.basename(path_)
                    })
                })
            }
        },
        Launch: (name, client_id = "", options = { custom_params: { game: {}, jvm: {} }, refresh_user: true, custom_java_home: "" }) => {
            let launch_command = ''

            const version_dir = oml.Direction.gameDir + `/versions/${name}/`
            const manifest = JSON.parse(readFileSync(version_dir + `/${name}.json`));

            const natives = manifest['natives'];
            const lib_paths = manifest['libraries'].filter(lib => Object.keys(utils.AnalyzeLibrary(lib)).length != 0 && !utils.AnalyzeLibrary(lib).isNative).map(lib => oml.Direction.gameDir + '/libraries/' + lib['downloads']['artifact']['path'])
            const jdk_major_ver = manifest['javaVersion']['majorVersion'];
            const launch_arguments_jvm = manifest['arguments'] != undefined ? manifest['arguments']['jvm'].concat(manifest['arguments']['default-user-jvm'] || []) : utils.getVersionInfo("1.16.5")['arguments']['jvm'];
            const launch_arguments_game = manifest['arguments'] != undefined ? manifest['arguments']['game'] : manifest['minecraftArguments'].split(" ");

            const launch_ = function (home) {
                const javaHome = home

                const isWindows = process.platform === 'win32';
                const executableName = isWindows ? 'java.exe' : 'java';
                const javaPath = path.join(javaHome, 'bin', executableName);
                const custom_jvm_parameter_keys = options.custom_params == undefined ? [] : Object.keys(options.custom_params.jvm);
                const custom_game_parameter_keys = options.custom_params == undefined ? [] : Object.keys(options.custom_params.game);

                if (javaPath.indexOf(" ") != -1) {
                    javaPath = `"${javaPath}"`
                }
                launch_command += javaPath;
                //Unzip native files.
                natives.forEach((native) => {
                    new AdmZip(native).extractAllTo(`${oml.Direction.gameDir}/versions/${name}/natives/`);
                    log.info("Finished extracting native " + native)
                })

                launch_arguments_jvm.forEach(arg => {
                    switch (typeof arg) {
                        case 'string':
                            launch_command += ` ${arg}`;
                            break;
                        case 'object':
                            const value = arg['value'];
                            if (Object.keys(arg).indexOf("rules") != -1) {
                                if (utils.rulesAnalyzer(arg['rules'])[`${getSystemName()}-${getSystemName() == 'linux' ? '' : getArch()}`]) {
                                    switch (typeof value) {
                                        case "string":
                                            launch_command += ` ${value}`;
                                            break;
                                        case "object":
                                            value.forEach(arg_ => {
                                                launch_command += ` ${arg_}`;
                                            });
                                            break;

                                        default:
                                            break;
                                    }
                                }
                            } else {
                                switch (typeof value) {
                                    case "string":
                                        launch_command += ` "${value}"`;
                                        break;
                                    case "object":
                                        value.forEach(arg_ => {
                                            launch_command += ` "${arg_}"`;
                                        });
                                        break;

                                    default:
                                        break;
                                }
                            }
                            break;

                        default:
                            break;
                    }

                });
                const custom_jvm_parameters = custom_jvm_parameter_keys.filter(k => launch_command.indexOf(k) == -1).map(k => `"${k}=${options.custom_params.jvm[k]}"`).join(" ")

                launch_command += ` ${custom_jvm_parameters} ${manifest['mainClass']}`

                launch_arguments_game.forEach(arg => {
                    switch (typeof arg) {
                        case 'string':
                            launch_command += ` ${arg}`;
                            break;

                        default:
                            break;
                    }
                })

                if ((options.refresh_user != undefined && options.refresh_user) || (options.refresh_user == undefined)) oml.Account.refreshAccessToken(client_id);
                const user = (() => {
                    const index = oml.Account.getSelectedIndex();
                    return oml.Account.list()[index];
                })();


                const natives_directory = `${oml.Direction.gameDir}/versions/${name}/natives`;
                const launcher_name = 'OpenMLauncher';
                lib_paths.push(`${oml.Direction.gameDir}/versions/${name}/${name}.jar`)
                const classpath = lib_paths.map(v => v.indexOf(" ") == -1 ? v : `"${v}"`).join(getSystem() == 'windows' ? ";" : ":");
                const auth_player_name = user.mc_profile.name;
                const auth_uuid = user.mc_profile.id;
                const auth_access_token = Buffer.from(user.mc_profile.jwt_token, 'base64').toString('utf8');
                const game_directory = `${oml.Direction.gameDir}/versions/${name}`
                const assets_root = oml.Direction.gameDir.indexOf(" ") == -1 ? `${oml.Direction.gameDir}/assets/` : `"${oml.Direction.gameDir}/assets/"`;
                const assets_index_name = manifest['assets'];
                const library_directory = oml.Direction.gameDir.indexOf(" ") == -1 ? oml.Direction.gameDir + "/libraries/" : `"${oml.Direction.gameDir}/libraries/"`;

                let real_launch_command = launch_command
                    .replaceAll("${natives_directory}", natives_directory)
                    .replaceAll("${launcher_name}", launcher_name)
                    .replaceAll("${launcher_version}", oml.Core.version)
                    .replaceAll("${classpath}", classpath)
                    .replaceAll("${auth_player_name}", auth_player_name)
                    .replaceAll("${auth_uuid}", auth_uuid)
                    .replaceAll("${auth_access_token}", auth_access_token)
                    .replaceAll("${assets_index_name}", assets_index_name)
                    .replaceAll("${assets_root}", assets_root)
                    .replaceAll("${game_directory}", game_directory)
                    .replaceAll("${user_type}", "msa")
                    .replaceAll("${version_type}", `"${launcher_name}"`)
                    .replaceAll("${version_name}", name)
                    .replaceAll("${user_properties}", "{}")
                    .replaceAll("${classpath_separator}", getSystem() == "windows" ? ";" : ":")
                    .replaceAll("${library_directory}", library_directory)


                const custom_game_parameters = custom_game_parameter_keys.filter(k => launch_command.indexOf(k) == -1).map(k => options.custom_params.game[k].indexOf(" ") == -1 ? `${k} ${options.custom_params.game[k]}` : `"${k}" "${options.custom_params.game[k]}"`).join(" ");
                real_launch_command = real_launch_command.concat(" ").concat(custom_game_parameters)

                function parseCommandString(cmdStr) {
                    const args = [];
                    let current = '';
                    let inQuotes = false;
                    let escape = false;

                    for (let i = 0; i < cmdStr.length; i++) {
                        const ch = cmdStr[i];

                        if (escape) {
                            current += ch;
                            escape = false;
                            continue;
                        }

                        if (ch === '\\' && inQuotes) {
                            current += ch;
                            continue;
                        }

                        if (ch === '"') {
                            if (inQuotes) {
                                inQuotes = false;
                                if (i + 1 < cmdStr.length && cmdStr[i + 1] !== ' ') {
                                    current += ch;
                                }
                            } else {
                                inQuotes = true;
                            }
                            continue;
                        }

                        if (ch === ' ' && !inQuotes) {
                            if (current.length > 0) {
                                args.push(current);
                                current = '';
                            }
                            continue;
                        }

                        current += ch;
                    }

                    if (current.length > 0) {
                        args.push(current);
                    }

                    return args;
                }
                log.info("Launching game " + name);
                const command_list = parseCommandString(real_launch_command);
                const args = command_list.filter((cmd, i) => i != 0);
                const mc_process = spawn(command_list[0], args);

                let rl = readline.createInterface({
                    input: mc_process.stdout,
                    crlfDelay: Infinity
                })
                log.info(`----- ${name} is running, there are outputs from Minecraft -----`)
                rl.on("line", (data) => {
                    console.log(data)
                })
                mc_process.stderr.on("data", (d) => {
                    console.error(d)
                })
                rl.on("close", (c) => {
                    log.info(`----- ${name} is closed with code ${c} -----`)
                })
            }
            //Analyze JDK Version
            if (options.custom_java_home.length == 0) {
                oml.Runtime.getAllRuntimes().then(v => {
                    if (v.filter(j => j['home'] != null).filter(jdk => Number.parseInt(jdk['major']) >= Number.parseInt(jdk_major_ver)).length == 0) {
                        log.info("Doesn't find suitable Java version on your computer! Try to install Java " + jdk_major_ver + "!");
                        return;
                    } else {
                        launch_(v.filter(j => j['home'] != null).filter(jdk => Number.parseInt(jdk['major']) >= Number.parseInt(jdk_major_ver)).sort((a, b) => a['major'] - b['major'])[0].home)
                    }
                })
            } else {
                launch_(options.custom_java_home)
            }
        },
        listAllVersions: (withCategory = false) => {
            const result = [];
            const versions_dir_path = oml.Direction.gameDir + "/versions/";

            const dirs = readdirSync(versions_dir_path, { withFileTypes: true }).filter(e => e.isDirectory());

            dirs.forEach(v => {
                const version_name = v.name;
                const version_json = JSON.parse(readFileSync(path.join(versions_dir_path, version_name, `${version_name}.json`)));
                const version_jar_exists = existsSync(path.join(versions_dir_path, version_name, `${version_name}.jar`));

                const minecraft_version = Object.keys(version_json).indexOf("clientVersion") == -1 ? version_json['id'] : version_json['clientVersion'];

                if (version_jar_exists) {
                    const a = {
                        name: version_name,
                        directory: path.join(versions_dir_path, version_name),
                        minecraftVersion: minecraft_version
                    };
                    if (withCategory) a['category'] = ((data) => {
                        if(data.mainClass == 'net.minecraft.client.main.Main') return 'Vanilla';
                        const libraries = data.libraries || [];
                        const libNames = libraries
                            .map(lib => lib.name || '')
                            .filter(name => name.length > 0);
                        if (libNames.some(name => name.startsWith('net.neoforged:'))) {
                            return 'NeoForge';
                        }
                        if (libNames.some(name => name.startsWith('net.minecraftforge'))) {
                            return 'Forge';
                        }
                        if (libNames.some(name => name.includes('fabric-loader') || name.startsWith('net.fabricmc:fabric-loader'))) {
                            return 'Fabric';
                        }
                        if (libNames.some(name => name.includes('quilt-loader') || name.startsWith('org.quiltmc:quilt-loader'))) {
                            return 'Quilt';
                        }
                        if (libNames.some(name => name.includes('launchwrapper') || name.startsWith('net.minecraft:launchwrapper'))) {
                            if (libNames.some(name => name.includes('liteloader'))) {
                                return 'LiteLoader';
                            }
                            if (libNames.some(name => name.includes('rift'))) {
                                return 'Rift';
                            }
                            return 'Forge';
                        }
                    })(version_json);
                    result.push(a);
                } else {
                    const a = {
                        name: version_name,
                        status: "error",
                        description: "No version JAR file.",
                        directory: path.join(versions_dir_path, version_name)
                    };
                    if (withCategory) a['category'] = 'error'
                    result.push(a)
                }
            })

            return result;
        }
    },
    Direction: {
        gameDir: process.argv[
            process.argv.indexOf(
                process.argv.find(arg => arg.indexOf("gameDir") != -1)
            ) + 1
        ] || `${__dirname}/.minecraft`,
        configDir: process.argv[
            process.argv.indexOf(
                process.argv.find(arg => arg.indexOf("configDir") != -1)
            ) + 1
        ] || `${__dirname}/.oml`
    },
    Account: {
        list: () => {
            return JSON.parse(
                Buffer.from(readFileSync(`${oml.Direction.configDir}/users.config`, 'utf8'), 'base64').toString('utf8')
            )['users']
        },
        add: (method, client_id, open_url_mode = () => {}) => {
            if (client_id.length == 0) {
                log.error("client_id is required!")
                return;
            }
            let user = new User();
            let process;
            if (method == AuthorizationMode.DeviceCode) {
                process = DeviceCodeAuthorization(client_id)
            } else if (method == AuthorizationMode.AuthorizationCode) {
                process = AuthorizationCodeMethod(client_id, open_url_mode)
            } else {
                log.error("Invalid authorization method!")
                return 0;
            }
            process.then((token_json) => {
                user.setMicrosoftProfile(token_json);
                user.setMinecraftProfile(XBL_Auth(token_json));

                const cfdDir = oml.Direction.configDir;
                let source = {
                    users: []
                };
                if (!existsSync(cfdDir)) {
                    mkdirSync(cfdDir, { recursive: true });
                }
                if (existsSync(`${cfdDir}/users.config`)) {
                    source = JSON.parse(
                        Buffer.from(readFileSync(`${cfdDir}/users.config`, 'utf8'), 'base64').toString('utf8')
                    );
                }
                let data = user.toJSON();
                let users_name = []
                source.users.forEach((usr) => {
                    users_name.push(usr.mc_profile.name)
                });
                if (!users_name.includes(data.mc_profile.name)) {
                    source.users.push(data);
                    if (!source['selectedIndex']) source['selectedIndex'] = 0
                    writeFile(`${cfdDir}/users.config`, Buffer.from(JSON.stringify(source, null, 2)).toString("base64"), function (err) {
                        if (err) {
                            log.error("Failed to save user data!");
                        } else {
                            log.info("User data saved successfully!");
                        }
                    });
                } else {
                    log.info("This user have already existed!");
                }
            })
        },
        remove: (name) => {
            const accounts = oml.Account.list();
            const filtered = accounts.filter(account => account.mc_profile.name !== name);
            writeFileSync(`${oml.Direction.configDir}/users.config`, Buffer.from(JSON.stringify(filtered, null, 2)).toString("base64"));
        },
        select: (index) => {
            const cfdDir = oml.Direction.configDir;
            let source = {
                users: []
            };
            if (existsSync(`${cfdDir}/users.config`)) {
                source = JSON.parse(
                    Buffer.from(readFileSync(`${cfdDir}/users.config`, 'utf8'), "base64").toString('utf8')
                );

                source['selectedIndex'] = source.users.findIndex((v) => v.mc_profile.name == index);
                log.info("Finished selecting account: " + index)
            } else {
                log.info("Didn't add any account! Configuration file not found!")
            }
        },
        refreshAccessToken: (client_id) => {
            if (client_id.length == 0) {
                log.error("client_id is required!")
                return;
            }
            const cfdDir = oml.Direction.configDir;
            let source = {
                users: []
            };
            if (existsSync(`${cfdDir}/users.config`)) {
                const cfg = Buffer.from(readFileSync(`${cfdDir}/users.config`, 'utf8'), 'base64').toString('utf8');
                source = JSON.parse(cfg);
                const user = source.users[source['selectedIndex']];
                const refresh_token = Buffer.from(
                    user['ms_profile']['refresh_token'],
                    'base64'
                ).toString('utf8');
                const resp = JSON.parse(
                    request("POST", "https://login.microsoftonline.com/consumers/oauth2/v2.0/token", {
                        headers: {
                            'content-type': "application/x-www-form-urlencoded"
                        },
                        body: `client_id=${client_id}&refresh_token=${refresh_token}&grant_type=refresh_token&scope=XboxLive.signin offline_access`
                    }).getBody()
                );
                const refreshed_user = new User();
                refreshed_user.setMicrosoftProfile(resp);
                refreshed_user.setMinecraftProfile(XBL_Auth(resp))
                source.users.filter(u => source.users.indexOf(u) != source.users.indexOf(user)).push(refreshed_user.toJSON());
                source['selectedIndex'] = source.users.indexOf(refreshed_user.toJSON());
            } else {
                log.info("Didn't add any account! Configuration file not found!")
            }
        },
        getSelectedIndex: () => {
            const cfdDir = oml.Direction.configDir;
            let source = {
                users: []
            };
            if (existsSync(`${cfdDir}/users.config`)) {
                source = JSON.parse(
                    Buffer.from(readFileSync(`${cfdDir}/users.config`, 'utf8'), 'base64').toString('utf8')
                );
                return source['selectedIndex'];
            } else {
                log.info("Didn't add any account! Configuration file not found!")
            }
        }
    },
    Runtime: {
        getAllRuntimes: async () => {
            const execPromise = promisify(exec);
            /**
             * 检测系统上所有通过环境变量可用的 Java 运行时
             * @returns {Promise<Array<{home: string|null, version: string, major: number|null, source: string}>>}
             */
            async function detectJavaFromEnv() {
                const results = [];
                const processed = new Set();

                const javaHome = process.env.JAVA_HOME;
                if (javaHome) {
                    const normalized = path.normalize(javaHome);
                    if (!processed.has(normalized)) {
                        const info = await getJavaInfoFromHome(normalized, 'JAVA_HOME');
                        if (info) {
                            results.push(info);
                            processed.add(normalized);
                        }
                    }
                }

                const pathEnv = process.env.PATH || '';
                const pathDirs = pathEnv.split(path.delimiter).filter(Boolean);
                const uniqueDirs = [...new Set(pathDirs)];

                for (const dir of uniqueDirs) {
                    const normalizedDir = path.normalize(dir);
                    const javaExe = platform() === 'win32' ? 'java.exe' : 'java';
                    const javaPath = path.join(normalizedDir, javaExe);
                    if (existsSync(javaPath)) {
                        let realPath = javaPath;
                        try {
                            realPath = realpathSync(javaPath);
                        } catch (_) {

                        }
                        let homeDir = path.dirname(path.dirname(realPath));
                        const isLikelyHome = existsSync(path.join(homeDir, 'bin', javaExe)) ||
                            existsSync(path.join(homeDir, 'bin', platform() === 'win32' ? 'javac.exe' : 'javac'));
                        if (!isLikelyHome) {
                            homeDir = null;
                        }
                        const key = homeDir || realPath;
                        if (!processed.has(key)) {
                            const info = await getJavaInfoFromPath(realPath, homeDir);
                            if (info) {
                                results.push(info);
                                processed.add(key);
                            }
                        }
                    }
                }

                return results;
            }
            async function getJavaInfoFromHome(homeDir, source) {
                const javaExe = platform() === 'win32' ? 'java.exe' : 'java';
                const javaPath = path.join(homeDir, 'bin', javaExe);
                if (!existsSync(javaPath)) return null;
                return getJavaInfo(javaPath, homeDir, source);
            }
            async function getJavaInfoFromPath(javaPath, homeDir) {
                let source = 'PATH';
                if (homeDir) {
                    source = 'PATH (推断)';
                }
                return getJavaInfo(javaPath, homeDir, source);
            }
            async function getJavaInfo(javaPath, homeDir, source) {
                try {
                    const { stderr } = await execPromise(`"${javaPath}" -version`);
                    const versionMatch = stderr.match(/version "([^"]+)"/);
                    if (!versionMatch) return null;
                    const versionStr = versionMatch[1];
                    let major = null;
                    const parts = versionStr.split(/[._-]/);
                    if (parts[0] === '1' && parts.length > 1) {
                        major = parseInt(parts[1], 10);
                    } else {
                        major = parseInt(parts[0], 10);
                    }
                    return {
                        home: homeDir || null,
                        version: versionStr,
                        major: isNaN(major) ? null : major,
                        source: source || 'unknown'
                    };
                } catch (error) {
                    return null;
                }
            }
            return await detectJavaFromEnv();
        },
        installSuitableRuntime: (mc_version) => {
            const majorVersion = utils.getVersionInfo(mc_version)['javaVersion']['majorVersion'];
            const targetDir = `${oml.Direction.gameDir}/runtimes/jre-${majorVersion}`;
            log.info(`JRE ${majorVersion} will be installing for a while. Direction: ${targetDir}`)
            return new Promise((resolve, reject) => {
                downloadTemurinJDK({
                    version: majorVersion,
                    targetExtractDir: targetDir
                }).then((res) => {
                    log.info(`JRE ${res.version} has successfully installed at ${res.javaPath}`)
                    resolve(res);
                }).catch(reason => {
                    log.error(`Installation failed. Error Message: ${reason}`);
                    reject(reason);
                })
            })
        }
    }
}
const AuthorizationMode = {
    DeviceCode: "DeviceCode",
    AuthorizationCode: "AuthorizationCode",
}
const DeviceCodeAuthorization = function (client_id) {
    return new Promise((resolve, reject) => {
        const resp = JSON.parse(
            request("POST", "https://login.microsoftonline.com/consumers/oauth2/v2.0/devicecode", {
                headers: {
                    'content-type': "application/x-www-form-urlencoded"
                },
                body: `client_id=${client_id}&scope=XboxLive.signin%20offline_access`
            })
        );
        clipboard.writeSync(resp.user_code);

        open(resp.verification_uri);

        setInterval(() => {
            const tokenResp = JSON.parse(
                request("POST", "https://login.microsoftonline.com/consumers/oauth2/v2.0/token", {
                    headers: {
                        'content-type': "application/x-www-form-urlencoded"
                    },
                    body: `client_id=${client_id}&grant_type=urn:ietf:params:oauth:grant-type:device_code&device_code=${resp.device_code}`
                }).getBody()
            );
            if (tokenResp.access_token) {
                resolve(tokenResp);
            }
        }, resp.interval * 1000);
    })
};
const AuthorizationCodeMethod = async function (client_id, verify_open_method) {
    return new Promise((resolve, reject) => {
        const Url = `https://login.microsoftonline.com/consumers/oauth2/v2.0/authorize?client_id=${client_id}&response_type=code&redirect_uri=http://localhost:3217&response_mode=query&prompt=consent&scope=XboxLive.signin offline_access`
        const code_generate_token = function (code) {
            const resp = JSON.parse(
                request("POST", "https://login.microsoftonline.com/consumers/oauth2/v2.0/token", {
                    headers: {
                        'content-type': "application/x-www-form-urlencoded"
                    },
                    body: `client_id=${client_id}&code=${code}&grant_type=authorization_code&redirect_uri=http://localhost:3217&scope=XboxLive.signin offline_access`
                }).getBody()
            )
            resolve(resp);
        }
        code_generate_token(verify_open_method(Url, "localhost:3217"));
    })
}
const XBL_Auth = function (token_json) {
    const res = request("POST", "https://user.auth.xboxlive.com/user/authenticate", {
        headers: {
            'content-type': "application/json",
            'accept': "application/json"
        },
        json: {
            "Properties": {
                "AuthMethod": "RPS",
                "SiteName": "user.auth.xboxlive.com",
                "RpsTicket": `d=${token_json.access_token} `
            },
            "RelyingParty": "http://auth.xboxlive.com",
            "TokenType": "JWT"
        }
    });
    return XSTS_Auth(JSON.parse(res.getBody()))
}
const XSTS_Auth = function (xbl_resp) {
    const xbl_token = xbl_resp['Token'];

    const body_data = {
        "Properties": {
            "SandboxId": "RETAIL",
            "UserTokens": [
                xbl_token
            ]
        },
        "RelyingParty": "rp://api.minecraftservices.com/",
        "TokenType": "JWT"
    }

    const resp = request("POST", "https://xsts.auth.xboxlive.com/xsts/authorize", {
        headers: {
            'accept': "application/json",
            'content-type': "application/json"
        },
        json: body_data
    })
    return MinecraftAuth(JSON.parse(resp.getBody()))
}
const MinecraftAuth = (xsts_resp) => {

    const body_data = {
        "identityToken": `XBL3.0 x=${xsts_resp['DisplayClaims']['xui'][0]['uhs']};${xsts_resp['Token']}`
    }

    const resp = JSON.parse(
        request("POST", "https://api.minecraftservices.com/authentication/login_with_xbox", {
            headers: {
                'content-type': "application/json",
                'accept': "application/json"
            },
            json: body_data
        }).getBody()
    );
    if (VerifyOwnership(resp)) return getProfile(resp['access_token']);
}
const VerifyOwnership = (resp) => {
    const access_token = resp['access_token'];

    const resp_ = JSON.parse(
        request("GET", "https://api.minecraftservices.com/entitlements/mcstore", {
            headers: {
                authorization: `Bearer ${access_token}`,
                "content-type": "application/json",
                "accept": "application/json"
            }
        }).getBody()
    );
    if (Object.keys(resp_).length == 0) {
        return false;
    }
    return true;
}
const getProfile = (access_token) => {
    const resp = JSON.parse(
        request("GET", "https://api.minecraftservices.com/minecraft/profile", {
            headers: {
                authorization: `Bearer ${access_token}`,
                'content-type': "application/json",
                "accept": "application/json"
            }
        }).getBody()
    );
    if (resp['error']) {
        return null;
    }
    const result = {
        ...resp, jwt_token: Buffer.from(access_token).toString('base64')
    }
    return result;
}
module.exports = { oml, AuthorizationMode };