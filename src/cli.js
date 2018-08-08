const commander = require("commander");
const fs = require("fs");
const { Logger } = require("./logger");
const cluster = require("cluster");
const { SSLocal } = require("./ssLocal");
const net = require("net");
const _ = require("lodash");
commander.option("-c, --config [configFile]", "server config file").parse(process.argv);

function extend(target) {
    var sources = [].slice.call(arguments, 1);
    sources.forEach(source => {
        for (var prop in source) {
            target[prop] = source[prop];
        }
    });
    return target;
}
function start(config) {
    let logger = new Logger("ssLocal_");
    let ssLocal = new SSLocal(config, logger);
    ssLocal.startServer();
}
// callback (err, servers), err is an array, servers is an array
function validateConfig(configFile, callback) {
    fs.readFile(configFile, "utf8", (err, data) => {
        if (err) {
            return callback([err], null);
        }
        let configObj = JSON.parse(data);
        if (!configObj.servers || !configObj.servers.length) {
            return callback(["No defined servers in config file"], null);
        }
        // apply default to each server config
        let config_servers = configObj.servers;
        for (let i in config_servers) {
            config_servers[i] = extend({}, configObj.default, config_servers[i]);
        }
        let errors = [];
        // validate each servers
        let localAddrSet = new Set();
        for (let i in config_servers) {
            let curSrv = config_servers[i];
            if (!curSrv.serverAddr || !curSrv.serverPort) {
                errors.push(`server #${i} - serverAddr/serverPort not defined`);
                continue;
            }
            if (!curSrv.localAddr || !curSrv.localPort) {
                errors.push(`server #${i} - localAddr/localPort not defined`);
                continue;
            }
            if (!curSrv.method) {
                errors.push(`server #${i} - method not defined`);
                continue;
            }
            if (!curSrv.password) {
                errors.push(`server #${i} - password not defined`);
                continue;
            }
            if (!curSrv.timeout) {
                curSrv.timeout = 600;
            }
            let localAddrUrl = curSrv.localAddr + ":" + curSrv.localPort;
            localAddrSet.add(localAddrUrl);
        }
        return callback(errors.length ? errors : null, config_servers);
    });
}

module.exports = {
    cli() {
        if (!commander.config) {
            commander.outputHelp();
            process.exit(1);
        } else {
            validateConfig(commander.config, (err, servers) => {
                if (err) {
                    console.log("Failed to start ss-cluster, errors:");
                    err.forEach(e => console.log("  * " + e));
                    process.exit(2);
                }
                if (cluster.isMaster) {
                    console.log(`Trying to start ${servers.length} ss-local instances`);
                    for (let i = 0; i < servers.length; i++) {
                        cluster.fork();
                    }
                    net.createServer(function(socket) {
                        const tmp_servers = [];
                        for (let i = 0; i < servers.length; i++) {
                            const server = servers[i];
                            if (!server.isDied) {
                                tmp_servers.push(server);
                            }
                        }
                        let rd = _.random(0, tmp_servers.length - 1, false);
                        let server = tmp_servers[rd];
                        if (!server) {
                            socket.destroy();
                            return;
                        }
                        server.diedTime = server.diedTime || 2 * 1000;
                        let client = net.connect(server.localPort);
                        socket.pipe(client).pipe(socket);
                        // client.on("close", onClose);
                        // client.on("connect", onConnect);
                        // client.on("error", onError.bind(this));
                        function onClose() {}
                        function onConnect() {
                            // console.log(new Date().toLocaleString());
                            // console.log(server);
                            // server.isDied = false;
                        }
                        function onError(err) {
                            // if (!server.isDied) {
                            //     setTimeout(function() {
                            //         server.isDied = false;
                            //     }, server.diedTime);
                            // }
                            // server.isDied = true;
                            // let rd = _.random(0, tmp_servers.length - 1, false);
                            // let server2 = tmp_servers[rd];
                            // if (!server2) {
                            //     return;
                            // }
                            // let client = net.connect(server2.localPort);
                            // client.on("close", onClose);
                            // client.on("connect", onConnect);
                            // client.on("error", onError.bind(this));
                            // console.log("Error: " + err.toString());
                        }
                    }).listen(1080);
                } else {
                    const server = servers[cluster.worker.id - 1];
                    start(server);
                }
            });
        }
    }
};
