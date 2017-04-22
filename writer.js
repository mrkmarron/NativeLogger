/*
* This module implements a range of writers for the core logger.
*/

'use strict';

/**
 * Create a basic console writer 
 */
function createStdoutWriter() {
    const process = require('process');
    let sb = [];
    return {
        emitChar: function (c) {
            sb.push(c);
        },
        emitFullString: function (str) {
            sb.push(str);
        },
        emitMsgStart: function (formatName) {
            sb.push(formatName);
            sb.push('> ');
        },
        emitMsgEnd: function () {
            sb.push('\n');
        },
        needsToDrain: function () {
            if (sb.length > 512) {
                return true;
            }

            return false;
        },
        drain: function () {
            process.stdout.write(sb.join(''));
            sb.length = 0;
        }
    }
}
exports.createStdoutWriter = createStdoutWriter;

/**
 * Create a basic string writer
 */
function createStringWriter() {
    let sb = [];
    return {
        emitChar: function (c) {
            sb.push(c);
        },
        emitFullString: function (str) {
            sb.push(str);
        },
        emitMsgStart: function (formatName) {
            sb.push(formatName);
            sb.push('> ');
        },
        emitMsgEnd: function () {
            sb.push('\n');
        },
        needsToDrain: function () {
            if (sb.length > 512) {
                return true;
            }

            return false;
        },
        drain: function () {
            this.lastMsg = sb.join('');
            sb.length = 0;
        }
    }
}
exports.createStringWriter = createStringWriter;
