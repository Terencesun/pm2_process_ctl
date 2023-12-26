const pm2 = require("pm2");
const pmx = require("pmx");
const path = require("path");
const fs = require("fs");
const _ = require("lodash");

const conf = pmx.initModule({});

let configStore = [];

const clearRequire = (reqPath) => {
    delete require.cache[require.resolve(path.normalize(reqPath))];
}

const readProcessFile = () => {
    const rConfig = JSON.parse(fs.readFileSync(conf.module_conf.config_file));
    configStore = [ ...rConfig ];
}

const pm2List = () => {
    return new Promise((resolve, reject) => {
        pm2.list((err, processDescriptionList) => {
            if (err) reject(err);
            resolve(processDescriptionList);
        });
    });
}

const pm2Delete = (pm_id) => {
    return new Promise((resolve, reject) => {
        pm2.delete(pm_id, err => {
            if (err) reject(err);
            resolve(true);
        });
    });
}

const pm2Start = (cwd, ecosystemConfig) => {
    return new Promise((resolve, reject) => {
        for (const meta of ecosystemConfig) {
            meta["cwd"] = meta["cwd"] ? path.resolve(cwd, meta["cwd"]) : cwd;
        }
        console.log(ecosystemConfig);
        pm2.start(ecosystemConfig, err => {
            if (err) {
                console.error(err);
                reject(err);
            };
            resolve(true);
        });
    });
}

const checkAndBootProcess = async () => {
    const processDescriptionList = await pm2List();
    const processList = _.filter(processDescriptionList, x => !x.pm2_env.pmx_module);
    for (const process of processList) {
        const findData = _.find(configStore, x => path.resolve(path.normalize(x), "../") === path.normalize(process.pm2_env.pm_cwd));
        if (!findData) {
            // 删除进程
            await pm2Delete(process.pm_id);
        }
    }
    for (const configPath of configStore) {
        const findData = _.find(processList, x => path.normalize(x.pm2_env.pm_cwd) === path.resolve(path.normalize(configPath), "../"));
        if (!findData) {
            // 创建进程
            clearRequire(configPath);
            const ctx = require(configPath);
            await pm2Start(path.resolve(path.normalize(configPath), "../"), ctx["apps"]);
        }
    }
}

const listenFile = () => {
    setInterval(async () => {
        readProcessFile();
        await checkAndBootProcess();
    }, 5000);
};

const handleError = () => {
    process.on("unhandledRejection", (reason, p) => {
        console.error(p);
        console.error(reason);
        pm2.disconnect();
        process.exit(1);
    });
    process.on("uncaughtException", err => {
        console.error(err);
        pm2.disconnect();
        process.exit(1);
    });
}

function main() {
    handleError();
    pm2.connect(async err => {
        if (err) return console.error(err.stack || err);
        if (!conf.module_conf.config_file) return console.error("no config file path setted.");

        // 读取配置文件
        readProcessFile();
        // 检查进程
        await checkAndBootProcess();

        // 设置文件监听
        listenFile();
    });
}

main();
