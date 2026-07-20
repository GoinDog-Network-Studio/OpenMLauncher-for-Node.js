import download from "download-file";
import { arch, platform, release } from "os";
import path from "path";
import { writeFileSync, readFileSync, existsSync, mkdirSync, writeFile, readFile, createReadStream, cp } from "fs";
import clipboard from "clipboardy";
import open from "opn";
import { Application } from "@webviewjs/webview";
import { parse } from "url";
import { exec } from "child_process";
import { findRuntimes } from "jdk-utils";
import * as unzipper from 'unzipper';
import request from "sync-request";
import { Buffer } from "buffer";
import * as readline from 'readline';
import { downloadTemurinJDK } from "temurin-jdk-downloader";
const manifest = (() => {
    return JSON.parse(request("GET", "https://piston-meta.mojang.com/mc/game/version_manifest.json").getBody());
})()
const thr_count = 32;
const utils = {
    getVersionInfo(ver) {
        const pkg = manifest['versions'].find(v => v.id == ver)["url"];
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
        if (Object.keys(lib).indexOf("rules") != -1) {
            os_config = this.rulesAnalyzer(lib['rules']);
            if (os_config[`${getSystemName()}-${getArch()}`]) {
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
        } else {
            res = lib['downloads']['artifact'];
            res['isNative'] = false;
        }
        return res;
    }
}
const log = {
    info: (msg) => {
        console.log(`[INFO/${new Date().getTime()}] ${msg}`);
    },
    warn: (msg) => {
        console.warn(`[WARN/${new Date().getTime()}] ${msg}`);
    },
    error: (msg) => {
        console.error(`[ERROR/${new Date().getTime()}] ${msg}`);
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
        version: "v0.0.1 beta"
    },
    Game: {
        Vanilla: {
            getAllVersions: function () {
                return manifest['versions'];
            },
            LATEST_RELEASE: (() => {
                return manifest['latest']['release'];
            })(),
            LATEST_SNAPSHOT: (() => {
                return manifest['latest']['snapshot'];
            })(),
            Install: (version, name = version) => {
                log.info(`Installing Minecraft ${version} to ${oml.Direction.gameDir}...`);
                const info = utils.getVersionInfo(version);
                // Download Client JAR File
                const client_url = info['downloads']['client']['url'];
                const ver_dir = `${oml.Direction.gameDir}/versions/${name}/`;
                if (!existsSync(ver_dir)) {
                    mkdirSync(ver_dir, { recursive: true })
                }
                download(client_url, {
                    directory: ver_dir,
                    filename: `${name}.jar`
                }, () => {
                    log.info("Download client has done.")
                });
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
                                const lib_url = analyzedData['url'];
                                const lib_path = `${oml.Direction.gameDir}/libraries/${analyzedData['path']}`
                                log.info("Downloading library " + analyzedData['path'])
                                download(lib_url, {
                                    directory: path.dirname(lib_path),
                                    filename: path.basename(lib_path)
                                }, () => {
                                    resolve();
                                })
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

        },
        Fabric: {
            Install: (name, minecraft_version, fabric_version) => {
                download("https://maven.fabricmc.net/net/fabricmc/fabric-installer/1.1.1/fabric-installer-1.1.1.jar", {
                    directory: oml.Direction.configDir + "/tmp/",
                    filename: "fabric_installer.jar"
                }, () => {
                    exec(`java -cp ${oml.Direction.configDir + "/tmp/fabric_installer.jar"} net.fabricmc.installer.Main client -dir ${oml.Direction.gameDir + "/versions/" + name + "/"} -mcversion ${minecraft_version} -loader ${fabric_version}`, (err, stdout, stderr) => {
                        if (err) {
                            log.error(`exec error: ${err}`);
                            return;
                        }
                        log.info(`stdout: ${stdout}`);
                        log.error(`stderr: ${stderr}`);
                    })
                })
            }
        },
        NeoForge: {

        },
        Launch: (name, client_id) => {
            let launch_command = ''

            const version_dir = oml.Direction.gameDir + `/versions/${name}/`
            const manifest = JSON.parse(readFileSync(version_dir + `/${name}.json`));

            const natives = manifest['natives'];
            const lib_paths = manifest['libraries'].filter(lib => Object.keys(utils.AnalyzeLibrary(lib)).length != 0 && !utils.AnalyzeLibrary(lib).isNative).map(lib => oml.Direction.gameDir + '/libraries/' + lib['downloads']['artifact']['path'])
            const jdk_major_ver = manifest['javaVersion']['majorVersion'];
            const launch_arguments_jvm = manifest['arguments']['jvm'].concat(manifest['arguments']['default-user-jvm'] || []);
            const launch_arguments_game = manifest['arguments']['game'] || manifest['minecraftArguments'].split(" ");

            //Analyze JDK Version
            oml.Runtime.getAllRuntimes().then(v => {
                if (v.filter(jdk => Number.parseInt(jdk['version']['major']) >= Number.parseInt(jdk_major_ver)).length == 0) {
                    log.info("Doesn't find suitable Java version on your computer! Try to install Java " + jdk_major_ver + "!");
                    return;
                } else {
                    const javaHome = v.filter(jdk => Number.parseInt(jdk['version']['major']) >= Number.parseInt(jdk_major_ver))[0].homedir;

                    const isWindows = process.platform === 'win32';
                    const executableName = isWindows ? 'java.exe' : 'java';
                    const javaPath = path.join(javaHome, 'bin', executableName);

                    launch_command += `"${javaPath}"`;
                    //Unzip native files.
                    natives.forEach((native) => {
                        createReadStream(native)
                            .pipe(unzipper.Extract({ path: `${oml.Direction.gameDir}/versions/${name}/natives/` }))
                            .on('close', () => {
                                log.info("Finished extracting native " + native)
                            })
                    })

                    launch_arguments_jvm.forEach(arg => {
                        switch (typeof arg) {
                            case 'string':
                                launch_command += ` "${arg}"`;
                                break;
                            case 'object':
                                const value = arg['value'];
                                if (Object.keys(arg).indexOf("rules") != -1) {
                                    if (utils.rulesAnalyzer(arg['rules'])[`${getSystemName()}-${getSystemName() == 'linux' ? '' : getArch()}`]) {
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

                    launch_command += ` ${manifest['mainClass']}`

                    launch_arguments_game.forEach(arg => {
                        switch (typeof arg) {
                            case 'string':
                                launch_command += ` ${arg}`;
                                break;

                            default:
                                break;
                        }
                    })

                    oml.Account.refreshAccessToken(client_id);
                    const user = (() => {
                        const index = oml.Account.getSelectedIndex();
                        return oml.Account.list()[index];
                    })();


                    const natives_directory = `${oml.Direction.gameDir}/versions/${name}/natives`;
                    const launcher_name = 'OpenMLauncher';
                    lib_paths.push(`${oml.Direction.gameDir}/versions/${name}/${name}.jar`)
                    const classpath = lib_paths.map(v => `"${v}"`).join(";");
                    const auth_player_name = user.mc_profile.name;
                    const auth_uuid = user.mc_profile.id;
                    const auth_access_token = Buffer.from(user.mc_profile.jwt_token, 'base64').toString('utf8');
                    const game_directory = `${oml.Direction.gameDir}/versions/${name}`
                    const assets_root = `${oml.Direction.gameDir}/assets/`;
                    const assets_index_name = manifest['assets'];

                    const real_launch_command = launch_command
                        .replaceAll("${natives_directory}", natives_directory)
                        .replaceAll("${launcher_name}", launcher_name)
                        .replaceAll("${launcher_version}", oml.Core.version)
                        .replaceAll("${classpath}", classpath)
                        .replaceAll("${auth_player_name}", auth_player_name)
                        .replaceAll("${auth_uuid}", auth_uuid)
                        .replaceAll("${auth_access_token}", auth_access_token)
                        .replaceAll("${assets_index_name}", assets_index_name)
                        .replaceAll("${assets_root}", `"${assets_root}"`)
                        .replaceAll("${game_directory}", `"${game_directory}"`)
                        .replaceAll("${user_type}", "msa")
                        .replaceAll("${version_type}", `"${launcher_name}"`)
                        .replaceAll("${version_name}", name)

                    log.info("Launching game " + name);
                    const mc_process = exec(real_launch_command);
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
            })
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
        add: (method, client_id) => {
            let user = new User();
            let process;
            if (method == AuthorizationMode.DeviceCode) {
                process = DeviceCodeAuthorization(client_id)
            } else if (method == AuthorizationMode.AuthorizationCode) {
                process = AuthorizationCodeMethod(client_id)
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
            const filtered = accounts.filter(account => account.uuid !== uuid);
            writeFileSync(`${oml.Direction.configDir}/users.config`, JSON.stringify(filtered, null, 2));
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
        getAllRuntimes: () => {
            return findRuntimes({
                checkJavac: true,
                withTags: true,
                withVersion: true
            })
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
                    resolve();
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
const AuthorizationCodeMethod = async function (client_id) {
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
        const app = new Application();
        const webview = app.createBrowserWindow({
            width: 1000,
            height: 800,
            title: "Microsoft账户登录"
        }).createWebview({
            url: Url
        })

        webview.addListener("navigation", (ev) => {
            const parsed_url = parse(ev.url, true);
            if (parsed_url.host == "localhost:3217") {
                const code = parsed_url.query.code;
                app.exit()
                code_generate_token(code);
            };
        })
        app.run();
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
export { oml, AuthorizationMode };