/*
 * File: plugin.js
 * Project: steam-comment-service-bot
 * Created Date: 25.02.2022 14:12:17
 * Author: 3urobeat
 *
 * Last Modified: 2025-02-17 19:46:34
 * Modified By: 3urobeat
 *
 * Copyright (c) 2022 - 2025 3urobeat <https://github.com/3urobeat>
 *
 * This program is free software: you can redistribute it and/or modify it under the terms of the GNU General Public License as published by the Free Software Foundation, either version 3 of the License, or (at your option) any later version.
 * This program is distributed in the hope that it will be useful, but WITHOUT ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the GNU General Public License for more details.
 * You should have received a copy of the GNU General Public License along with this program. If not, see <https://www.gnu.org/licenses/>.
 */


const fs      = require("fs");
const express = require("express");
let logger    = require("output-logger");

const PluginSystem  = require("../../src/pluginSystem/pluginSystem.js"); // eslint-disable-line
const pluginPackage = require("./package.json"); // eslint-disable-line


/**
 * Constructor - Creates a new object for this plugin
 * @class
 * @param {PluginSystem} sys Your connector to the application
 */
const Plugin = function(sys) {
    logger = sys.controller.logger; // Overwrites logger function from lib with our modified one. Import above remains to keep IntelliSense support

    // Store references to commonly used properties
    this.sys            = sys;
    this.controller     = sys.controller;
    this.data           = sys.controller.data;
    this.commandHandler = sys.commandHandler;

    this.app;
    this.server;
};

// Export everything in this file to make it accessible to the plugin loader
module.exports = Plugin;


/**
 * This function will be called by the plugin loader after updating but before logging in. Initialize your plugin here.
 */
Plugin.prototype.load = async function() {
    this.pluginConfig = await this.sys.loadPluginConfig(pluginPackage.name);

    this.app = express();

    // Generate requestKey if it is not created already
    if (!this.pluginConfig.requestKey) {
        this.pluginConfig.requestKey = Math.random().toString(36).slice(-10); // Credit: https://stackoverflow.com/a/9719815/12934162
        logger("info", "Webserver plugin: Generated a new secret key for comment requests via url. You can find the key in the 'package.json' file of this plugin.");

        this.sys.writePluginConfig(pluginPackage.name, this.pluginConfig);
    }

};


/**
 * This function will be called when the plugin gets reloaded (not on bot stop). It allows you to destroy any objects so the next load won't throw any errors.
 */
Plugin.prototype.unload = function() {
    logger("info", "Webserver plugin: Closing running webserver...");

    this.server.close();
};


/**
 * This function will be called when the bot is ready (aka all accounts were logged in).
 */
Plugin.prototype.ready = function() {

    /**
     * Our commandHandler respondModule implementation - Sends a response to the webpage visitor.
     * This is limited to one response, so we won't be able to send the finished message for example but this is not really needed I guess.
     * @param {Object} _this The Plugin object context
     * @param {Object} resInfo Object containing information passed to the command. Supported by this handler: res
     * @param {String} txt The text to send
     */
    function respondModule(_this, resInfo, txt) {
        if (resInfo.res.headersSent) return; // If we already sent a response with this header then ignore request to avoid an error

        resInfo.res.status(200).send(txt);
    }


    // Listen for visitors
    this.app.get("/", (req, res) => {
        res.status(200).send(`<title>Comment Bot Web Request</title><b>${this.data.datafile.mestr}'s Comment Bot | Comment Web Request</b></br>Please use /comment?n=123&id=123&key=123 to request n comments on id profile with your secret key.</br>If you forgot your secret key you can see it in your 'data.json' file in the 'src' folder.</br></br>Visit /output to see the complete output.txt in your browser!</b></br></br>https://github.com/3urobeat/steam-comment-service-bot`);
    });

    this.app.get("/comment", async (req, res) => {
        let ip = String(req.headers["x-forwarded-for"] || req.socket.remoteAddress).replace("::ffff:", ""); // Get IP of visitor

        // Get provided parameters
        let amount       = req.query.n;
        let receivingID  = req.query.id;
        let requestingID = this.data.cachefile.ownerid[0]; // SteamID: Make the bot owner responsible for request


        // Check provided parameters
        if (!amount) {
            logger("info", `Webserver plugin: Request by ${ip} denied. Reason: numberofcomments (n) is not specified.`);
            return res.status(400).send("You have to provide an amount of comments.</br>Usage: /comment?n=123&id=123&key=123 to request n comments on id profile with your secret key.</br>If you forgot your secret key you can see it in your 'data.json' file in the 'src' folder.");
        }

        if (!receivingID) {
            logger("info", `Webserver plugin: Request by ${ip} denied. Reason: Steam profileid (id) is not specified.`);
            return res.status(400).send("You have to provide a profile id where I should comment.</br>Usage: /comment?n=123&id=123&key=123 to request n comments on id profile with your secret key.</br>If you forgot your secret key you can see it in your 'data.json' file in the 'src' folder.");
        }

        if (!req.query.key || req.query.key != this.pluginConfig.requestKey) {
            logger("warn", `Webserver plugin: Request by ${ip} denied. Reason: Invalid secret key.`); // I think it is fair to output this message with a warn type
            return res.status(403).send("Your secret key is not defined or invalid. Request denied.</br>If you forgot your secret key you can see it in your 'data.json' file in the 'src' folder.</br>Usage: /comment?n=123&id=123&key=123 to request n comments on id profile with your secret key.");
        }

        logger("info", `Webserver plugin: Comment Request from ${ip} accepted. Amount: ${amount} | Profile: ${receivingID}`);


        // Run the comment command
        let runResponse = await this.commandHandler.runCommand("comment", [ amount, receivingID ], respondModule, this, { res: res, userID: requestingID });

        if (!runResponse.success) {
            return res.status(500).send(runResponse.message || runResponse.reason);
        }
    });

    this.app.get("/output", (req, res) => { // Show output
        // Get IP of visitor
        let ip = String(req.headers["x-forwarded-for"] || req.socket.remoteAddress).replace("::ffff:", "");

        logger("info", `Webserver plugin: ${ip} requested to see the output!`);

        fs.readFile(srcdir + "/../output.txt", (err, data) => {
            if(err) logger("error", "urltocomment: error reading output.txt: " + err);

            res.write(String(data));
            res.status(200);
            res.end();
        });
    });

    this.app.use((req, res) => { // Show idk page thanks
        res.status(404).send("404: Page not Found.</br>Please use /comment?n=123&id=123&key=123 to request n comments on id profile with your secret key.");
    });


    // Start webserver and handle error
    this.server = this.app.listen(3034, () => {
        logger("info", "Webserver is enabled: Server is listening on port 3034.\n       Visit it in your browser: http://localhost:3034\n", true);
    });

    this.server.on("error", (err) => {
        logger("error", "Webserver plugin: An error occurred trying to start the webserver! " + err, true);
    });

};
