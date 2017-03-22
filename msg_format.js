/*
* This module provides the representation of our msg formats and provides 
* functionality for converting strings or objects into the format.
*/

////
//Valid expandos are:
//#ip_addr     -- ip address of the host
//#app_name    -- name of the root app
//#module_name -- name of the module
//#msg_name    -- name of the msg (what it was registered with)
//#wall_time    -- wallclock timestamp
//#logical_time -- logical timestamp
//#callback_id -- the current callback id
//#request_id  -- the current request id (for http requests)
//##           -- a literal #
//
//Valid format specifiers are:
//${p:b} -- a boolean value
//${p:n} -- a number
//${p:s} -- a string
//${p:o<d,l>} -- an object expanded up to d levels (default is 2) at most l items in any level (default is * for objects 128 for arrays)
//${p:a<d,l>} -- an array expanded up to d levels (default is 2) at most l items in any level (default is * for objects 128 for arrays)
//${p:g} -- general value (general format applied -- no array expansion, object depth of 2)
//$$ -- a literal $

//TODO: add date, currency, and arraybuffer formatting options

////

'use strict';

/**
 * Tag values for logging levels.
 * @exports
 */
exports.LoggingLevels = {
    OFF: { label: 'OFF', enum: 0x0 },
    FATAL: { label: 'FATAL', enum: 0x1 },
    ERROR: { label: 'ERROR', enum: 0x3 },
    WARN: { label: 'WARN', enum: 0x7 },
    INFO: { label: 'INFO', enum: 0xF },
    DEBUG: { label: 'DEBUG', enum: 0x1F },
    TRACE: { label: 'TRACE', enum: 0x3F },
    ALL: { label: 'ALL', enum: 0xFF }
};

/**
 * Tag values for system info logging levels.
 * @exports
 */
exports.SystemInfoLevels = {
    OFF: { label: 'OFF', enum: 0x0 },
    REQUEST: { label: 'REQUEST', enum: 0x100 },
    ASYNC: { label: 'ASYNC', enum: 0x300 },
    ALL: { label: 'ALL', enum: 0xF00 }
};

//Default values we expand objects and arrays to
let DEFAULT_EXPAND_DEPTH = 2;
let DEFAULT_EXPAND_OBJECT_LENGTH = 1024;
let DEFAULT_EXPAND_ARRAY_LENGTH = 128;

/////////////////////////////
//Generally useful code

function typeGetName(value) {
    return toString.call(value);
}

function typeIsSimple(typename) {
    return (typename === '[object Undefined]' || typename === '[object Null]');
}

function typeIsBoolean(typename) {
    return (typename === '[object Boolean]');
}

function typeIsNumber(typename) {
    return (typename === '[object Number]');
}

function typeIsString(typename) {
    return (typename === '[object String]');
}

function typeIsDate(typename) {
    return (typename === '[object Date]');
}

function typeIsFunction(typename) {
    return (typename === '[object Function]');
}

function typeIsObject(typename) {
    return (typename === '[object Object]');
}

function typeIsArray(typename) {
    return (typename === '[object Array]' ||
        typename === '[object Float32Array]' || typename === '[object Float64Array]' ||
        typename === '[object Int8Array]' || typename === '[object Int16Array]' || typename === '[object Int32Array]' ||
        typename === '[object Uint8Array]' || typename === '[object Uint16Array]' || typename === '[object Uint32Array]');
}

/////////////////////////////
//Code for manipulating message format representations

function fse_generateLiteralEntry(name, label, enumval) {
    return { name: name, label: label, kind: 'literal', enum: enumval };
}

function fse_generateExpandoEntry(name, label, enumval) {
    return { name: name, label: label, kind: 'expando', enum: enumval };
}

function fse_generateBasicFormatterEntry(name, label, enumval) {
    return { name: name, label: label, kind: 'basicFormat', enum: enumval };
}

function fse_generateCompundFormatterEntry(name, label, enumval) {
    return { name: name, label: label, kind: 'compundFormat', enum: enumval };
}

/**
 * Tag values indicating the kind of each entry in the native log.
 */
let FormatStringEntryTag = {
    LITERAL_HASH: fse_generateLiteralEntry('LITERAL_HASH', '#', 0x1),
    IP_ADDR: fse_generateExpandoEntry('IP_ADDR', '#ip_addr', 0x2),
    APP_NAME: fse_generateExpandoEntry('APP_NAME', '#app_name', 0x3),
    MODULE_NAME: se_generateExpandoEntry('MODULE_NAME', '#module_name', 0x4),
    MSG_NAME: fse_generateExpandoEntry('MSG_NAME', '#msg_name', 0x5),
    WALLTIME: fse_generateExpandoEntry('WALL_TIME', '#wall_time', 0x6),
    LOGICAL_TIME: fse_generateExpandoEntry('LOGICAL_TIME', '#logical_time', 0x7),
    CALLBACK_ID: fse_generateExpandoEntry('CALLBACK_ID', '#callback_id', 0x8),
    REQUEST_ID: fse_generateExpandoEntry('REQUEST_ID', '#request_id', 0x9),

    LITERAL_DOLLAR: fse_generateLiteralEntry('LITERAL_DOLLAR', '$', 0x10),
    BOOL_VAL: fse_generateBasicFormatterEntry('BOOL_VAL', 'b', 0x20), //${p:b}
    NUMBER_VAL: fse_generateBasicFormatterEntry('NUMBER_VAL', 'n', 0x30), //${p:n}
    STRING_VAL: fse_generateBasicFormatterEntry('STRING_VAL', 's', 0x40), //${p:s}
    GENERAL_VAL: fse_generateBasicFormatterEntry('GENERAL_VAL', 'g', 0x50), //${p:g}
    OBJECT_VAL: fse_generateCompundFormatterEntry('OBJECT_VAL', 'o', 0x60), //${p:o<d,l>}
    ARRAY_VAL: fse_generateCompundFormatterEntry('ARRAY_VAL', 'a', 0x70) //${p:a<d,l>}
};
let ClearFormatStringEntryTag = 0x0;
let FormatStringEntryTag_Mask = 0xFF;

let s_expandoEntries = Object.keys(FormatStringEntryTag)
    .filter(function (value) { return value.kind === 'expando'; })
    .map(function (value) { return FormatStringEntryTag[value]; });

let s_basicFormatEntries = Object.keys(FormatStringEntryTag)
    .filter(function (value) { return value.kind === 'basicFormat'; })
    .map(function (value) { return FormatStringEntryTag[value]; });

let s_compoundFormatEntries = Object.keys(FormatStringEntryTag)
    .filter(function (value) { return value.kind === 'compundFormat'; })
    .map(function (value) { return FormatStringEntryTag[value].label; });

let s_expandoStringRe = new RegExp('^('
    + s_expandoEntries
        .map(function (value) { return FormatStringEntryTag[value].label; })
        .join('|')
    + ')$');

let s_basicFormatStringRe = new RegExp('^\\${(\\d+):('
    + s_basicFormatEntries
        .map(function (value) { return FormatStringEntryTag[value].label; })
        .join('|')
    + ')}$');

let s_compoundFormatStringRe = new RegExp('^\\${(\\d+):('
    + s_compoundFormatEntries
        .map(function (value) { return FormatStringEntryTag[value].label; })
        .join('|')
    + ')(<(\\d+|\\*)?,(\\d+|\\*)?>}$');

/**
 * Construct a msgFormat entry for an expando.
 * @function
 * @param {Object} formatTag a tag from FormatStringEntryTag
 * @param {number} formatStringStart where the formatter starts in the format string
 * @param {number} formatStringEnd where the formatter string ends -- entry is range [formatStringStart, formatStringEnd)
 */
function msgFormat_CreateExpando(formatTag, formatStringStart, formatStringEnd) {
    return { format: formatTag, formatStart: formatStringStart, formatEnd: formatStringEnd };
}

/**
 * Construct a msgFormat entry for a simple formatter.
 * @function
 * @param {Object} formatTag a tag from FormatStringEntryTag
 * @param {number} argListPosition the position of the format arg in the arglist
 * @param {number} formatStringStart where the formatter starts in the format string
 * @param {number} formatStringEnd where the formatter string ends -- entry is range [formatStringStart, formatStringEnd)
 */
function msgFormat_CreateBasicFormatter(formatTag, argListPosition, formatStringStart, formatStringEnd) {
    return { format: formatTag, argPosition: argListPosition, formatStart: formatStringStart, formatEnd: formatStringEnd };
}

/**
 * Construct a msgFormat entry for a compound formatter.
 * @function
 * @param {Object} formatTag a tag from FormatStringEntryTag
 * @param {number} argListPosition the position of the format arg in the arglist
 * @param {number} formatStringStart where the formatter starts in the format string
 * @param {number} formatStringEnd where the formatter string ends -- entry is range [formatStringStart, formatStringEnd)
 * @param {number} formatExpandDepth object expansion depth
 * @param {number} formatExpandLength object expansion length
 */
function msgFormat_CreateCompundFormatter(formatTag, argListPosition, formatStringStart, formatStringEnd, formatExpandDepth, formatExpandLength) {
    return { format: formatTag, argPosition: argListPosition, formatStart: formatStringStart, formatEnd: formatStringEnd, expandDepth: formatExpandDepth, expandLength: formatExpandLength };
}

/**
 * Take an array or object literal format representation and convert it to json string format representation.
 * @function
 * @param {*} jobj 
 * @return {string}
 */
function msgFormat_expandToJsonFormatter(jobj) {
    let typename = typeGetName(jobj);

    if (typeIsSimple(typename) || typeIsNumber(typename)) {
        return JSON.stringify(jobj);
    }
    else if (typeIsString(typename)) {
        if (s_expandoStringRe.test(jobj) || s_basicFormatStringRe.test(jobj) || s_compoundFormatStringRe.test(jobj)) {
            return jobj;
        }
        else {
            return '"' + jobj + '"';
        }
    }
    else if (typeIsArray(typename)) {
        return '[ '
            + jobj
                .map(function (value) { return msgFormat_expandToJsonFormatter(value); })
                .join(', ')
            + ' ]';
    }
    else if (typeIsObject(typename)) {
        return '{ '
            + Object.keys(jobj)
                .map(function (key) { return '"' + key + '"' + ': ' + msgFormat_expandToJsonFormatter(jobj[key]); })
                .join(', ')
            + ' }';
    }
    else {
        return '"' + jobj.toString() + '"';
    }
}

/**
 * Helper function to extract and construct an expando format specifier or throws is the expando is malformed
 * @function
 * @param {string} fmtString
 * @param {number} vpos
 * @returns {Object} format specifier object
 */
function msgFormat_extractExpandoSpecifier(fmtString, vpos) {
    if (fmtString.startsWith('##', vpos)) {
        return msgFormat_CreateExpando(FormatStringEntryTag.LITERAL_HASH, vpos, vpos + '##'.length);
    }
    else {
        let expando = s_expandoEntries.find(function (expando) { return fmtString.startsWith(expando.label); });
        if (!expando) {
            throw new Error("Bad match in expando format string.");
        }

        return msgFormat_CreateExpando(expando, vpos, vpos + expando.label.length);
    }
}

/**
 * Helper function to extract and construct an argument format specifier or throws is the format specifier is malformed.
 * @function
 * @param {string} fmtString
 * @param {number} vpos
 * @returns {Object} format specifier object
 */
function msgFormat_extractArgumentFormatSpecifier(fmtString, vpos) {
    if (fmtString.startsWith('$$', vpos)) {
        return msgFormat_CreateBasicFormatter(FormatStringEntryTag.LITERAL_DOLLAR, -1, vpos, vpos + '$$'.length);
    }
    else {
        if (!fmtString.startsWith('${', vpos)) {
            throw new Error("Stray '$' in argument formatter.");
        }

        let numberRegex = /\d+/y;
        numberRegex.lastIndex = vpos + '${'.length;

        let argPositionMatch = numberRegex.exec(fmtString);
        if (!argPositionMatch) {
            throw new Error("Bad position specifier in format.");
        }

        let argPosition = Number.parseInt(argPositionMatch[0]);
        if (argPosition < 0) {
            throw new Error("Bad position specifier in format.");
        }

        let specPos = vpos + '${'.length + argPositionMatch[0].length;
        if (fmtString.charAt(specPos) !== ':') {
            throw new Error("Bad position specifier in format.");
        }
        specPos++;

        let cchar = fmtString.charAt(specPos);
        let basicFormatOption = s_basicFormatEntries.find(function (value) { return value.label === cchar; });
        let compoundFormatOption = s_compoundFormatInfo.find(function (value) { return value.label === cchar; });

        if (!basicFormatOption && !compoundFormatOption) {
            throw new Error("Bad format specifier kind.");
        }

        if (basicFormatOption) {
            let fendpos = specPos + 2; //"x}".length
            return msgFormat_CreateBasicFormatter(basicFormatOption, argPosition, vpos, fendpos);
        }
        else {
            let DL_STAR = 1073741824;

            if (fmtString.startsWith('o}', specPos)) {
                return msgFormat_CreateCompundFormatter(FormatStringEntryTag.OBJECT_VAL, argPosition, vpos, specPos + 'o}'.length, DEFAULT_DEPTH, DEFAULT_OBJECT_LENGTH);
            }
            else if (fmtString.startsWith('a}', specPos)) {
                return msgFormat_CreateCompundFormatter(FormatStringEntryTag.ARRAY_VAL, argPosition, vpos, specPos + 'a}'.length, DEFAULT_DEPTH, DEFAULT_ARRAY_LENGTH);
            }
            else {
                let dlRegex = /([o|a])<(\d+|\*)?,(\d+|\*)?>/y;
                dlRegex.lastIndex = specPos;

                let dlMatch = dlRegex.exec(fmtString);
                if (!dlMatch) {
                    throw new Error("Bad position specifier in format.");
                }

                let ttag = (dlMatch[1] === 'o') ? FormatStringEntryTag.OBJECT_VAL : FormatStringEntryTag.ARRAY_VAL;
                let tdepth = DEFAULT_DEPTH;
                let tlength = (dlMatch[1] === 'o') ? DEFAULT_OBJECT_LENGTH : DEFAULT_ARRAY_LENGTH;

                if (dlMatch[2] !== '') {
                    tdepth = (dlMatch[2] !== '*') ? Number.parseInt(dlMatch[2]) : DL_STAR;
                }

                if (dlMatch[3] !== '') {
                    tlength = (dlMatch[3] !== '*') ? Number.parseInt(dlMatch[3]) : DL_STAR;
                }

                return msgFormat_CreateCompundFormatter(ttag, argPosition, vpos, specPos + dlMatch[0].length, tdepth, tlength);
            }
        }
    }
}


/**
 * Construct a msgFormat object.
 * @function
 * @param {string} fmtName is the name given to the format message
 * @param {string} fmtString the format string 
 * @param {number} maxArgPos the largest argument index used in the format message
 * @param {Array} fmtEntryArray the array of msgFormat entries (expandos and format strings) used
 */
function msgFormat_Create(fmtName, fmtString, maxArgPos, fmtEntryArray) {
    return { formatName: fmtName, formatString: fmtString, maxArgPosition: maxArgPos, formatterArray: fmtEntryArray };
}

/**
 * Takes a message format string and converts it to our internal format structure.
 * @function
 * @param {string} fmtName The name of the format string.
 * @param {*} fmtInfo The format string | a literal JSON format object/array
 * @throws If the format is ill-defined we throw an error.
 * @returns {Object} The format structure object 
 */
exports.extractMsgFormat = function (fmtName, fmtInfo) {
    let cpos = 0;

    if (typeof (fmtName) !== 'string') {
        throw 'Name needs to be a string.'
    }

    let fmtString = undefined;
    if (typeof (fmtInfo) === 'string') {
        fmtString = fmtInfo;
    }
    else {
        let typename = typeGetName(fmtInfo);
        if (!typeIsArray(typeGetName) && !typeIsObject(typename)) {
            throw new Error('Format description options are string | object layout | array layout.');
        }

        fmtString = msgFormat_expandToJsonFormatter(fmtInfo);
    }

    let newlineRegex = /(\n|\r)/
    if (newlineRegex.test(fmtString)) {
        throw new Error('Format cannot contain newlines.');
    }

    let fArray = [];
    let maxArgPos = 0;
    while (cpos < fmtString.length) {
        let cchar = fmtString.charAt(cpos);
        if (cchar !== '#' && cchar !== '$') {
            cpos++;
        }
        else {
            let fmt = (cchar === '#') ? msgFormat_extractExpandoSpecifier(fmtString, cpos) : msgFormat_extractArgumentFormatSpecifier(fmtString, cpos);
            fArray.push(fmt);

            if (fmt.fposition) {
                maxArgPos = Math.max(maxArgPos, fmt.fposition);
            }

            cpos = fmt.fend;
        }
    }

    return msgFormat_Create(fmtName, fmtString, maxArgPos, fArray);
}

/////////////////////////////
//Code for representing the log messages in the low overhead in memory-ring buffer and moving them into/out of this structure

/**
 * Tag values indicating the kind of each entry in the fast log buffer
 */
let LogEntryTags = {
    Clear: 0x0,

    MsgFormat: 0x100,     //The var is pointer to the formatInfo object
    MsgLevel: 0x200,      //The var is a tagged int of a logger level
    MsgEndSentinal: 0x300, //Sentinal marking the end of a log message

    LParen: 0x400,
    RParen: 0x500,
    LBrack: 0x600,
    RBrack: 0x700,
    PropertyRecord: 0x800,  //The entry contains a property record

    JsBadFormatVar: 0x1000, //The var is undefined due to an argument that did not match the format specifier
    JsVarValue: 0x2000,     //The var is a regular value 

    LengthBoundHit: 0x3000,
    CycleValue: 0x4000,
    OpaqueValue: 0x5000,
    OpaqueObject: 0x6000,
    OpaqueArray: 0x7000
};
let LogEntryTags_Mask = 0xFF00;

/**
 * When we are emitting we can be in multiple modes (formatting, objects, arrays, etc.) so we want tags (used below to indicate)
 */
let EmitMode = {
    Clear: 0x0,
    TopLevelMode: 0x1,
    SpanMessage: 0x2,
    MsgFormat: 0x3,
    ObjectMode: 0x4,
    ArrayMode: 0x5
};

/**
 * The number of entries we have in a msg block.
 */
const s_msgBlockSize = 1024;

/**
 * A helper function to allocate a new block of messages.
 */
function msgBlock_Create(previousBlock) {
    let nblock = {
        //number of slots used
        count: 0,

        //arrays holding the tag and entry data 
        tags: new Uint16Array(s_msgBlockSize),
        data: new Array(s_msgBlockSize),

        //DLL next/previous
        next: null,
        previous: (previousBlock ? previousBlock : null)
    };

    if (previousBlock) {
        previousBlock.next = nblock;
    }

    return nblock;
}

/**
 * A helper function to create a blocklist
 */
function msgBlock_CreateBlockList() {
    let iblock = msgBlock_Create(null);

    return {
        head: iblock,
        tail: iblock,
        jsonCycleMap: new Set()
    };
}

/**
 * A helper ensure we can write several entries to a block without allocating
 */
function msgBlock_EnsureDataSlots(blockList, size) {
    let block = blockList.tail;
    if (block.count + size >= s_msgBlockSize) {
        let block = msgBlock_Create(block);
        blockList.tail = block;
    }
}

/**
 * A helper function to add an entry to a block list
 */
function msgBlock_AddEntryToMsgBlock_Unchecked(blockList, tag, data) {
    //TODO: remove this later but we want it for initial debugging
    assert(blockList.tail.count < s_msgBlockSize, 'We missed a ensure size or got the computation wrong');

    let block = blockList.tail;
    block.tags[block.count] = tag;
    block.data[block.count] = data;
    block.count++;
}

function msgBlock_AddEntryToMsgBlockTagOnly_Unchecked(blockList, tag) {
    //TODO: remove this later but we want it for initial debugging
    assert(blockList.tail.count < s_msgBlockSize, 'We missed a ensure size or got the computation wrong');

    let block = blockList.tail;
    block.tags[block.count] = tag;
    block.count++;
}

/**
 * A helper function to add an entry to a block list
 */
function msgBlock_AddEntryToMsgBlock(blockList, tag, data) {
    let block = blockList.tail;
    if (block.count === s_msgBlockSize) {
        block = msgBlock_Create(block);
        blockList.tail = block;
    }

    block.tags[block.count] = tag;
    block.data[block.count] = data;
    block.count++;
}

function msgBlock_AddEntryToMsgBlockTagOnly(blockList, tag) {
    let block = blockList.tail;
    if (block.count === s_msgBlockSize) {
        block = msgBlock_Create(block);
        blockList.tail = block;
    }

    block.tags[block.count] = tag;
    block.count++;
}

/**
 * A helper function for storing formatted objects into our log
 */
function msgBlock_addObject_Internal(blockList, msgTag, obj, depth, length) {
    //if the value is in the set and is currently processing (value is TRUE)
    if (blockList.jsonCycleMap.has(obj)) {
        msgBlock_AddEntryToMsgBlockTagOnly(blockList, msgTag | LogEntryTags.CycleValue);
        return;
    }

    if (depth == 0) {
        msgBlock_AddEntryToMsgBlockTagOnly(blockList, msgTag | LogEntryTags.OpaqueObject);
    }
    else {
        //Set processing as true for cycle detection
        blockList.jsonCycleMap.add(obj);
        msgBlock_AddEntryToMsgBlockTagOnly(blockList, msgTag | LogEntryTags.LParen);

        let allowedLengthRemain = length;
        for (let p in obj) {
            msgBlock_AddEntryToMsgBlock(blockList, LogEntryTags.PropertyRecord, p);
            msgBlock_AddGeneralValue_Internal(blockList, ClearFormatStringEntryTag, obj[p], depth - 1);

            allowedLengthRemain--;
            if (allowedLengthRemain <= 0) {
                msgBlock_AddEntryToMsgBlockTagOnly(blockList, LogEntryTags.LengthBoundHit);
                break;
            }
        }

        //Set processing as false for cycle detection
        blockList.jsonCycleMap.delete(obj);
        msgBlock_AddEntryToMsgBlockTagOnly(blockList, LogEntryTags.RParen);
    }
}

/**
 * A helper function for storing formatted arrays into our log
 */
function msgBlock_addArray_Internal(blockList, msgTag, obj, depth, length) {
    //if the value is in the set and is currently processing (value is TRUE)
    if (blockListblockList.jsonCycleMap.has(obj)) {
        msgBlock_AddEntryToMsgBlockTagOnly(blockList, msgTag | LogEntryTags.CycleValue);
        return;
    }

    if (depth == 0) {
        msgBlock_AddEntryToMsgBlockTagOnly(blockList, msgTag | LogEntryTags.OpaqueObject);
    }
    else {
        //Set processing as true for cycle detection
        blockList.jsonCycleMap.add(obj);
        msgBlock_AddEntryToMsgBlockTagOnly(blockList, msgTag | LogEntryTags.LBrack);

        for (let i = 0; i < obj.length; ++i) {
            msgBlock_addGeneralValue_Internal(blockList, ClearFormatStringEntryTag, obj[i], depth - 1);

            if (i >= length) {
                msgBlock_AddEntryToMsgBlockTagOnly(blockList, LogEntryTags.LengthBoundHit);
                break;
            }
        }

        //Set processing as false for cycle detection
        blockList.jsonCycleMap.delete(obj);
        msgBlock_AddEntryToMsgBlockTagOnly(blockList, LogEntryTags.RBrack);
    }
}

/**
 * A helper function for storing formatted values into our log
 */
function msgBlock_addGeneralValue_Internal(blockList, msgTag, value, depth) {
    let typename = typeGetName(value);
    if (typeIsSimple(typename) || typeIsBoolean(typename) || typeIsNumber(typename) || typeIsString(typename)) {
        msgBlock_AddEntryToMsgBlock(blockList, msgTag | LogEntryTags.JsVarValue, value);
    }
    else if (typeIsDate(typename)) {
        msgBlock_AddEntryToMsgBlock(blockList, msgTag | LogEntryTags.JsVarValue, new Date(value));
    }
    else if (typeIsFunction(typename)) {
        msgBlock_AddEntryToMsgBlock(blockList, msgTag | LogEntryTags.JsVarValue, '[ #Function# ' + value.name + ' ]');
    }
    else if (typeIsObject(typename)) {
        msgBlock_addObject_Internal(blockList, msgTag, value, depth, DEFAULT_EXPAND_OBJECT_LENGTH);
    }
    else if (typeIsArray(typename)) {
        msgBlock_addArray_Internal(blockList, msgTag, value, depth, DEFAULT_EXPAND_ARRAY_LENGTH);
    }
    else {
        msgBlock_AddEntryToMsgBlockTagOnly(blockList, msgTag | LogEntryTags.OpaqueObject);
    }
}

////////

/**
 * Log a message into the logger
 * @function
 * @param {Object} blockList the blocklist to emit into
 * @param {Object} macroInfo the info on logger state that the expandos use
 * @param {Object} fmt the message format
 * @param {Array} args the array of arguments
 */
function logMessageGeneral(blockList, macroInfo, level, fmt, args) {
    msgBlock_EnsureDataSlots(blockList, 2);
    msgBlock_AddEntryToMsgBlock_Unchecked(blockList, LogEntryTags.MsgFormat, fmt);
    msgBlock_AddEntryToMsgBlock_Unchecked(blockList, LogEntryTags.MsgLevel, level);

    for (let i = 0; i < fmt.formatterArray.length; ++i) {
        let fentry = fmt.formatterArray[i];
        let value = undefined;
        let valuetype = undefined

        if (fentry.argPosition !== -1) {
            if (fentry.argPosition < args.length) {
                value = args[fentry.argPosition];
                valuetype = typeGetName(value);
            }
            else {
                //We hit a bad format value so rather than let it propigate -- report and move on.
                msgBlock_AddEntryToMsgBlock(blockList, fentry.enum | LogEntryTags.JsBadFormatVar, undefined);
                continue;
            }
        }

        switch (fentry.enum) {
            case 0x1: // literal # 
                //just break 
                break;
            case 0x2: //#ip_addr
                msgBlock_AddEntryToMsgBlock(blockList, fentry.enum, macroInfo.IP_ADDR);
                break;
            case 0x3: //#app_name
                msgBlock_AddEntryToMsgBlock(blockList, fentry.enum, macroInfo.APP_NAME);
                break;
            case 0x4: //#module_name
                msgBlock_AddEntryToMsgBlock(blockList, fentry.enum, macroInfo.MODULE_NAME);
                break;
            case 0x5: //#msg_name
                msgBlock_AddEntryToMsgBlock(blockList, fentry.enum, fmt.name);
                break;
            case 0x6: //#wall_time
                msgBlock_AddEntryToMsgBlock(blockList, fentry.enum, Date.now());
                break;
            case 0x7: //#logical_time
                msgBlock_AddEntryToMsgBlock(blockList, fentry.enum, macroInfo.LOGICAL_TIME);
                break;
            case 0x8: //#callback_id
                msgBlock_AddEntryToMsgBlock(blockList, fentry.enum, macroInfo.CALLBACK_ID);
                break;
            case 0x9: //#request_id
                msgBlock_AddEntryToMsgBlock(blockList, fentry.enum, macroInfo.REQUEST_ID);
                break;
            case 0x10: // literal $
                //just break 
                break;
            case 0x20: //${i:b}
                msgBlock_AddEntryToMsgBlock(blockList, fentry.enum | LogEntryTags.JsVarValue, value ? true : false);
                break;
            case 0x30: //${i:n}
                if (typeIsNumber(valuetype)) {
                    msgBlock_AddEntryToMsgBlock(blockList, fentry.enum | LogEntryTags.JsVarValue, value);
                }
                else {
                    msgBlock_AddEntryToMsgBlockTagOnly(blockList, fentry.enum | LogEntryTags.JsBadFormatVar);
                }
                break;
            case 0x40: //${i:s}
                if (typeIsString(valuetype)) {
                    msgBlock_AddEntryToMsgBlock(blockList, fentry.enum | LogEntryTags.JsVarValue, value);
                }
                else {
                    msgBlock_AddEntryToMsgBlockTagOnly(blockList, fentry.enum | LogEntryTags.JsBadFormatVar);
                }
                break;
            case 0x50: //${i:g}
                blockList.jsonCycleMap.clear();
                msgBlock_addGeneralValue_Internal(blockList, fentry.enum, value, DEFAULT_EXPAND_DEPTH);
                blockList.jsonCycleMap.clear();
                break;
            case 0x60: // ${i:o}
                if (typeIsObject(valuetype)) {
                    blockList.jsonCycleMap.clear();
                    msgBlock_addObject_Internal(blockList, fentry.enum, value, fmt.depth, fmt.length);
                    blockList.jsonCycleMap.clear();
                }
                else {
                    msgBlock_AddEntryToMsgBlockTagOnly(blockList, fentry.enum | LogEntryTags.JsBadFormatVar);
                }
                break;
            case 0x70: // ${i:a}
                if (typeIsArray(valuetype)) {
                    blockList.jsonCycleMap.clear();
                    msgBlock_addArray_Internal(blockList, fentry.enum, value, fmt.depth, fmt.length);
                    blockList.jsonCycleMap.clear();
                }
                else {
                    msgBlock_AddEntryToMsgBlockTagOnly(blockList, fentry.enum | LogEntryTags.JsBadFormatVar);
                }
                break;
            default:
                msgBlock_AddEntryToMsgBlockTagOnly(blockList, fentry.enum | LogEntryTags.JsBadFormatVar);
                break;
        }
    }

    msgBlock_AddEntryToMsgBlockTagOnly(blockList, LogEntryTags.MsgEndSentinal);
}

/**
 * Log a message into the logger -- when all formatting is simple
 * @function
 * @param {Object} blockList the blocklist to emit into
 * @param {Object} macroInfo the info on logger state that the expandos use
 * @param {Object} fmt the message format
 * @param {Array} args the array of arguments
 */
function logMessageSimpleFormatOnly(blockList, macroInfo, level, fmt, args) {
    msgBlock_EnsureDataSlots(blockList, 3 + fmt.formatterArray.length);
    msgBlock_AddEntryToMsgBlock_Unchecked(blockList, LogEntryTags.MsgFormat, fmt);
    msgBlock_AddEntryToMsgBlock_Unchecked(blockList, LogEntryTags.MsgLevel, level);

    for (let i = 0; i < fmt.formatterArray.length; ++i) {
        let fentry = fmt.formatterArray[i];
        let value = undefined;
        let valuetype = undefined

        if (fentry.argPosition !== -1) {
            if (fentry.argPosition < args.length) {
                value = args[fentry.argPosition];
                valuetype = typeGetName(value);
            }
            else {
                //We hit a bad format value so rather than let it propigate -- report and move on.
                msgBlock_AddEntryToMsgBlock_Unchecked(blockList, fentry.enum | LogEntryTags.JsBadFormatVar, undefined);
                continue;
            }
        }

        switch (fentry.enum) {
            case 0x1: // literal # 
                //just break 
                break;
            case 0x2: //#ip_addr
                msgBlock_AddEntryToMsgBlock_Unchecked(blockList, fentry.enum, macroInfo.IP_ADDR);
                break;
            case 0x3: //#app_name
                msgBlock_AddEntryToMsgBlock_Unchecked(blockList, fentry.enum, macroInfo.APP_NAME);
                break;
            case 0x4: //#module_name
                msgBlock_AddEntryToMsgBlock_Unchecked(blockList, fentry.enum, macroInfo.MODULE_NAME);
                break;
            case 0x5: //#msg_name
                msgBlock_AddEntryToMsgBlock_Unchecked(blockList, fentry.enum, fmt.name);
                break;
            case 0x6: //#wall_time
                msgBlock_AddEntryToMsgBlock_Unchecked(blockList, fentry.enum, Date.now());
                break;
            case 0x7: //#logical_time
                msgBlock_AddEntryToMsgBlock_Unchecked(blockList, fentry.enum, macroInfo.LOGICAL_TIME);
                break;
            case 0x8: //#callback_id
                msgBlock_AddEntryToMsgBlock_Unchecked(blockList, fentry.enum, macroInfo.CALLBACK_ID);
                break;
            case 0x9: //#request_id
                msgBlock_AddEntryToMsgBlock_Unchecked(blockList, fentry.enum, macroInfo.REQUEST_ID);
                break;
            case 0x10: // literal $
                //just break 
                break;
            case 0x20: //${i:b}
                msgBlock_AddEntryToMsgBlock_Unchecked(blockList, fentry.enum | LogEntryTags.JsVarValue, value ? true : false);
                break;
            case 0x30: //${i:n}
                if (typeIsNumber(valuetype)) {
                    msgBlock_AddEntryToMsgBlock_Unchecked(blockList, fentry.enum | LogEntryTags.JsVarValue, value);
                }
                else {
                    msgBlock_AddEntryToMsgBlockTagOnly_Unchecked(blockList, fentry.enum | LogEntryTags.JsBadFormatVar);
                }
                break;
            case 0x40: //${i:s}
                if (typeIsString(valuetype)) {
                    msgBlock_AddEntryToMsgBlock_Unchecked(blockList, fentry.enum | LogEntryTags.JsVarValue, value);
                }
                else {
                    msgBlock_AddEntryToMsgBlockTagOnly_Unchecked(blockList, fentry.enum | LogEntryTags.JsBadFormatVar);
                }
                break;
            default:
                msgBlock_AddEntryToMsgBlockTagOnly_Unchecked(blockList, fentry.enum | LogEntryTags.JsBadFormatVar);
                break;
        }
    }

    msgBlock_AddEntryToMsgBlockTagOnly_Unchecked(blockList, LogEntryTags.MsgEndSentinal);
}

/**
 * Log a message into the logger -- when there are no additional arguments (we just pass them to keep the signature the same)
 * @function
 * @param {Object} blockList the blocklist to emit into
 * @param {Object} macroInfo the info on logger state that the expandos use
 * @param {Object} fmt the message format
 * @param {Array} args the array of arguments
 */
function logMessageConstantString(blockList, macroInfo, level, fmt, args) {
    msgBlock_EnsureDataSlots(blockList, 3);
    msgBlock_AddEntryToMsgBlock_Unchecked(blockList, LogEntryTags.MsgFormat, fmt);
    msgBlock_AddEntryToMsgBlock_Unchecked(blockList, LogEntryTags.MsgLevel, level);
    msgBlock_AddEntryToMsgBlockTagOnly_Unchecked(blockList, LogEntryTags.MsgEndSentinal);
}

/////////////////////////////
//Code for filtering the in memory representation for writing out
