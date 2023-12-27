const pm2 = require("pm2");
const pmx = require("pmx");
const path = require("path");
const fs = require("fs");
const _ = require("lodash");
const parsePath = require("parse-path");
const sleep = require("sleepjs");

const conf = pmx.initModule({});

let configStore = [];

const clearRequire = (reqPath) => {
    delete require.cache[require.resolve(path.normalize(reqPath))];
}

const readProcessFile = () => {
    const rConfig = JSON.parse(fs.readFileSync(conf.module_conf.config_file));
    configStore = [];
    for (const meta of rConfig) {
        const originalMeta = path.normalize(meta).split("?");
        const normalizeMeta = originalMeta[0];
        const queryMeta = originalMeta[1] ? parsePath(`pm2://0.0.0.0?${originalMeta[1]}`).query : {};
        clearRequire(normalizeMeta);
        const ctx = require(normalizeMeta);
        configStore.push({
            key: normalizeMeta,
            value: ctx["apps"],
            payload: queryMeta,
        });
    }
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
        const findData = _.find(configStore, meta => _.find(meta["value"], x => x.name === process.name));
        if (!findData) {
            // 删除进程
            await pm2Delete(process.pm_id);
        }
    }
    for (const configObj of configStore) {
        const configValue = configObj["value"];
        const names = _.map(configValue, x => x.name);
        const processNames = _.map(processList, x => x.name);
        const diffDatas = _.filter(configValue, x => _.intersection(_.difference(names, processNames), names).includes(x["name"]));

        if (diffDatas.length !== 0) {
            // 创建进程
            const margin = parseInt(_.get(configObj, "payload.margin", 0), 10);
            await pm2Start(path.resolve(configObj["key"], "../"), diffDatas);
            await sleep.sleepMilliseconds(margin);
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
        console.log(`load config_file -> ${conf.module_conf.config_file}`);
        // 读取配置文件
        readProcessFile();
        // 检查进程
        await checkAndBootProcess();
        //
        // // 设置文件监听
        listenFile();
    });
}

main();
