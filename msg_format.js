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
LoggingLevels = {
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
SystemInfoLevels = {
    OFF: { label: 'OFF', enum: 0x0 },
    REQUEST: { label: 'REQUEST', enum: 0x100 },
    ASYNC: { label: 'ASYNC', enum: 0x300 },
    ALL: { label: 'ALL', enum: 0xF00 }
};

/**
 * Check if the given actualLevel is enabled with the current level checkLevel.
 */
function isLogLevelEnabled(actualLevel, checkLevel) {
    return (actualLevel & checkLevel !== 0);
}

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

function isSingleSlotFormatter(formatTag) {
    return formatTag.enum <= FormatStringEntryTag.STRING_VAL.enum;
}

/**
 * Construct a msgFormat entry for an expando.
 */
function msgFormat_CreateExpando(formatTag, formatStringStart, formatStringEnd) {
    return { format: formatTag, formatStart: formatStringStart, formatEnd: formatStringEnd };
}

/**
 * Construct a msgFormat entry for a simple formatter.
 */
function msgFormat_CreateBasicFormatter(formatTag, argListPosition, formatStringStart, formatStringEnd) {
    return { format: formatTag, argPosition: argListPosition, formatStart: formatStringStart, formatEnd: formatStringEnd };
}

/**
 * Construct a msgFormat entry for a compound formatter.
 */
function msgFormat_CreateCompundFormatter(formatTag, argListPosition, formatStringStart, formatStringEnd, formatExpandDepth, formatExpandLength) {
    return { format: formatTag, argPosition: argListPosition, formatStart: formatStringStart, formatEnd: formatStringEnd, expandDepth: formatExpandDepth, expandLength: formatExpandLength };
}

/**
 * Take an array or object literal format representation and convert it to json string format representation.
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
 */
function msgFormat_Create(fmtName, fmtString, maxArgPos, fmtEntryArray, areAllSingleSlotFormatters) {
    return { formatName: fmtName, formatString: fmtString, maxArgPosition: maxArgPos, formatterArray: fmtEntryArray, allSingleSlotFormatters: areAllSingleSlotFormatters };
}

/**
 * Takes a message format string and converts it to our internal format structure.
 */
function extractMsgFormat(fmtName, fmtInfo) {
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

    let allBasicFormatters = fArray.every(function (value) {
        return isSingleSlotFormatter(value);
    });

    return msgFormat_Create(fmtName, fmtString, maxArgPos, fArray, allBasicFormatters);
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
function msgBlock_createBlockList() {
    let iblock = msgBlock_Create(null);

    return {
        head: iblock,
        tail: iblock,
        jsonCycleMap: new Set()
    };
}

/**
 * A helper function to clear blocklist
 */
function msgBlock_clearBlockList(blockList) {
    blockList.head.tags.fill(0, blockList.head.count);
    blockList.head.data.fill(0, blockList.head.count);
    blockList.head.count = 0;
    blockList.head.next = null;

    blockList.tail = blockList.head;
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
function msgBlock_addObject_Internal(blockList, obj, depth, length) {
    //if the value is in the set and is currently processing (value is TRUE)
    if (blockList.jsonCycleMap.has(obj)) {
        msgBlock_AddEntryToMsgBlockTagOnly(blockList, LogEntryTags.CycleValue);
        return;
    }

    if (depth == 0) {
        msgBlock_AddEntryToMsgBlockTagOnly(blockList, LogEntryTags.OpaqueObject);
    }
    else {
        //Set processing as true for cycle detection
        blockList.jsonCycleMap.add(obj);
        msgBlock_AddEntryToMsgBlockTagOnly(blockList, LogEntryTags.LParen);

        let allowedLengthRemain = length;
        for (let p in obj) {
            msgBlock_AddEntryToMsgBlock(blockList, LogEntryTags.PropertyRecord, p);
            msgBlock_AddGeneralValue_Internal(blockList, LogEntryTags.JsVarValue, obj[p], depth - 1);

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
function msgBlock_addArray_Internal(blockList, obj, depth, length) {
    //if the value is in the set and is currently processing (value is TRUE)
    if (blockListblockList.jsonCycleMap.has(obj)) {
        msgBlock_AddEntryToMsgBlockTagOnly(blockList, LogEntryTags.CycleValue);
        return;
    }

    if (depth == 0) {
        msgBlock_AddEntryToMsgBlockTagOnly(blockList, LogEntryTags.OpaqueObject);
    }
    else {
        //Set processing as true for cycle detection
        blockList.jsonCycleMap.add(obj);
        msgBlock_AddEntryToMsgBlockTagOnly(blockList, LogEntryTags.LBrack);

        for (let i = 0; i < obj.length; ++i) {
            msgBlock_addGeneralValue_Internal(blockList, obj[i], depth - 1);

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
function msgBlock_addGeneralValue_Internal(blockList, value, depth) {
    let typename = typeGetName(value);
    if (typeIsSimple(typename) || typeIsBoolean(typename) || typeIsNumber(typename) || typeIsString(typename)) {
        msgBlock_AddEntryToMsgBlock(blockList, LogEntryTags.JsVarValue, value);
    }
    else if (typeIsDate(typename)) {
        msgBlock_AddEntryToMsgBlock(blockList, LogEntryTags.JsVarValue, new Date(value));
    }
    else if (typeIsFunction(typename)) {
        msgBlock_AddEntryToMsgBlock(blockList, LogEntryTags.JsVarValue, '[ #Function# ' + value.name + ' ]');
    }
    else if (typeIsObject(typename)) {
        msgBlock_addObject_Internal(blockList, value, depth, DEFAULT_EXPAND_OBJECT_LENGTH);
    }
    else if (typeIsArray(typename)) {
        msgBlock_addArray_Internal(blockList, value, depth, DEFAULT_EXPAND_ARRAY_LENGTH);
    }
    else {
        msgBlock_AddEntryToMsgBlockTagOnly(blockList, LogEntryTags.OpaqueObject);
    }
}

////////

/**
 * Log a message into the logger
 */
function msgBlock_logMessageGeneral(blockList, macroInfo, level, fmt, args) {
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
                msgBlock_AddEntryToMsgBlock(blockList, LogEntryTags.JsVarValue, macroInfo.IP_ADDR);
                break;
            case 0x3: //#app_name
                msgBlock_AddEntryToMsgBlock(blockList, LogEntryTags.JsVarValue, macroInfo.APP_NAME);
                break;
            case 0x4: //#module_name
                msgBlock_AddEntryToMsgBlock(blockList, LogEntryTags.JsVarValue, macroInfo.MODULE_NAME);
                break;
            case 0x5: //#msg_name
                msgBlock_AddEntryToMsgBlock(blockList, LogEntryTags.JsVarValue, fmt.name);
                break;
            case 0x6: //#wall_time
                msgBlock_AddEntryToMsgBlock(blockList, LogEntryTags.JsVarValue, Date.now());
                break;
            case 0x7: //#logical_time
                msgBlock_AddEntryToMsgBlock(blockList, LogEntryTags.JsVarValue, macroInfo.LOGICAL_TIME);
                break;
            case 0x8: //#callback_id
                msgBlock_AddEntryToMsgBlock(blockList, LogEntryTags.JsVarValue, macroInfo.CALLBACK_ID);
                break;
            case 0x9: //#request_id
                msgBlock_AddEntryToMsgBlock(blockList, LogEntryTags.JsVarValue, macroInfo.REQUEST_ID);
                break;
            case 0x10: // literal $
                //just break 
                break;
            case 0x20: //${i:b}
                if (typeIsSimple(valuetype) || typeIsBoolean(valuetype) || typeIsNumber(valuetype)) {
                    msgBlock_AddEntryToMsgBlock(blockList, LogEntryTags.JsVarValue, value ? true : false);
                }
                else {
                    msgBlock_AddEntryToMsgBlockTagOnly(blockList, LogEntryTags.JsBadFormatVar);
                }
                break;
            case 0x30: //${i:n}
                if (typeIsNumber(valuetype)) {
                    msgBlock_AddEntryToMsgBlock(blockList, LogEntryTags.JsVarValue, value);
                }
                else {
                    msgBlock_AddEntryToMsgBlockTagOnly(blockList, LogEntryTags.JsBadFormatVar);
                }
                break;
            case 0x40: //${i:s}
                if (typeIsString(valuetype)) {
                    msgBlock_AddEntryToMsgBlock(blockList, LogEntryTags.JsVarValue, value);
                }
                else {
                    msgBlock_AddEntryToMsgBlockTagOnly(blockList, LogEntryTags.JsBadFormatVar);
                }
                break;
            case 0x50: //${i:g}
                blockList.jsonCycleMap.clear();
                msgBlock_addGeneralValue_Internal(blockList, value, DEFAULT_EXPAND_DEPTH);
                blockList.jsonCycleMap.clear();
                break;
            case 0x60: // ${i:o}
                if (typeIsObject(valuetype)) {
                    blockList.jsonCycleMap.clear();
                    msgBlock_addObject_Internal(blockList, value, fmt.depth, fmt.length);
                    blockList.jsonCycleMap.clear();
                }
                else {
                    msgBlock_AddEntryToMsgBlockTagOnly(blockList, LogEntryTags.JsBadFormatVar);
                }
                break;
            case 0x70: // ${i:a}
                if (typeIsArray(valuetype)) {
                    blockList.jsonCycleMap.clear();
                    msgBlock_addArray_Internal(blockList, value, fmt.depth, fmt.length);
                    blockList.jsonCycleMap.clear();
                }
                else {
                    msgBlock_AddEntryToMsgBlockTagOnly(blockList, LogEntryTags.JsBadFormatVar);
                }
                break;
            default:
                msgBlock_AddEntryToMsgBlockTagOnly(blockList, LogEntryTags.JsBadFormatVar);
                break;
        }
    }

    msgBlock_AddEntryToMsgBlockTagOnly(blockList, LogEntryTags.MsgEndSentinal);
}

/**
 * Log a message into the logger -- when all formatting is simple
 */
function msgBlock_logMessageSimpleFormatOnly(blockList, macroInfo, level, fmt, args) {
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
 * Log a message into the logger -- when there are no additional arguments
 */
function msgBlock_logMessageConstantString(blockList, macroInfo, level, fmt, args) {
    msgBlock_EnsureDataSlots(blockList, 3);
    msgBlock_AddEntryToMsgBlock_Unchecked(blockList, LogEntryTags.MsgFormat, fmt);
    msgBlock_AddEntryToMsgBlock_Unchecked(blockList, LogEntryTags.MsgLevel, level);
    msgBlock_AddEntryToMsgBlockTagOnly_Unchecked(blockList, LogEntryTags.MsgEndSentinal);
}

/**
 * The main function for logging a message to the block list.
 */
function logMsg(blockList, macroInfo, level, fmt, args) {
    if (fmt.formatterArray.length === 0) {
        msgBlock_logMessageConstantString(blockList, macroInfo, level, fmt);
    }
    else if (fmt.allSingleSlotFormatters) {
        msgBlock_logMessageSimpleFormatOnly(blockList, macroInfo, level, fmt, args);
    }
    else {
        msgBlock_logMessageGeneral(blockList, macroInfo, level, fmt, args);
    }
}

/////////////////////////////
//Code for filtering the in memory representation and for writing out

/**
 * Check if the message (starting at cblock[cpos]) is enabled for writing at the given level
 */
function isLevelEnabledForWrite(cblock, cpos, trgtLevel) {
    //TODO: take this out later for performance but good initial sanity check
    assert((cpos + 1 < cblock.count) ? cblock.tags[cpos + 1] : block.next.tags[0] === LogEntryTags.MsgLevel);

    let mlevel = (cpos + 1 < cblock.count) ? cblock.data[cpos + 1] : block.next.data[0];
    return isLogLevelEnabled(mlevel, trgtLevel);
}

/**
 * (1) Filter out all the msgs that we want to drop when writing to disk and copy them to the pending write list.
 * (2) Process the blocks for native emitting (if needed)
 */
function processMsgsForWrite(inMemoryBlockList, retainLevel, pendingWriteBlockList) {
    let scanForMsgEnd = false;
    for (let cblock = inMemoryBlockList.head; cblock !== null; cblock = cblock.next) {
        for (let pos = 0; pos < cblock.count; ++pos) {
            if (scanForMsgEnd) {
                scanForMsgEnd = (cblock.tags[pos] !== LogEntryTags.MsgEndSentinal);
            }
            else {
                if (cblock.tags[pos] === LogEntryTags.MsgFormat && !isLevelEnabledForWrite(cblock, pos, retainLevel)) {
                    scanForMsgEnd = true;
                }
                else {
                    msgBlock_AddEntryToMsgBlock(pendingWriteBlockList, cblock.tags[pos], cblock.tags[pos]);
                }
            }
        }
    }
    msgBlock_clearBlockList(inMemoryBlockList);

    if (global.processForNativeWrite) {
        process.stderr.write('Native writing is not implemented yet!!!');
    }
}

/////////////////////////////
//Code for pure JS write to storage

/**
 * When we are emitting we can be in multiple modes (formatting, objects, arrays, etc.) so we want tags (used below to indicate)
 */
let EmitModes = {
    Clear: 0x0,
    MsgFormat: 0x1,
    ObjectLevel: 0x2,
    ArrayLevel: 0x3
};

/**
 * Create an emit state stack entry for a formatter msg
 */
function emitStack_createFormatterState(fmt) {
    return { mode: EmitModes.MsgFormat, commaInsert: false, format: fmt, formatterIndex: 0 };
}

/**
 * Create an emit state stack entry for an object or array format
 */
function emitStack_createJSONState(emitMode) {
    return { mode: emitMode, commaInsert: false };
}

/**
 * Check and update the need to insert a comma in our output
 */
function emitStack_checkAndUpdateNeedsComma(emitEntry) {
    if (emitEntry.commaInsert) {
        return true;
    }
    else {
        emitEntry.commaInsert = true;
        return false;
    }
}

/**
 * Get the start position for a span of literal text in a format string to emit.
 */
function emitStack_getFormatRangeStart(emitEntry) {
    return emitEntry.format.formatterArray[emitEntry.formatterIndex].end;
}

/**
 * Get the end position for a span of literal text in a format string to emit.
 */
function emitStack_getFormatRangeEnd(emitEntry) {
    let fmtArray = emitEntry.format.formatterArray;
    return (emitEntry.formatterIndex + 1 < fmtArray.length) ? fmtArray[emitEntry.formatterIndex + 1].start : emitEntry.format.formatString.length;
}

function emitter_emitJsString(str, writer) {
    writer.emitChar('"');
    writer.emitFullString(str);
    writer.emitChar('"');
}

function emitter_emitEntryStart(writer) {
    writer.emitChar('>');
}

function emitter_emitEntryEnd(writer) {
    writer.emitChar('\n');
}

/**
 * Emit a simple var (JsVarValue tag)
 * @param {Object} value 
 * @param {Object} writer 
 */
function emitter_emitSimpleVar(value, writer) {
    if (value === undefined) {
        writer.emitFullString('undefined');
    }
    else if (value === 'null') {
        writer.emitFullString('null');
    }
    else {
        writer.emitFullString(value.toString());
    }
}

/**
 * Emit a special var as indicated by the tag
 * @param {Object} tag
 * @param {Object} writer 
 */
function emitter_emitSpecialVar(tag, writer) {
    switch (tag) {
        case LogEntryTags.JsBadFormatVar:
            writer.emitFullString('"<BadFormat>"');
            break;
        case LogEntryTags.LengthBoundHit:
            writer.emitFullString('<LengthBoundHit>"');
            break;
        case LogEntryTags.CycleValue:
            writer.emitFullString('"<Cycle>"');
            break;
        case LogEntryTags.OpaqueValue:
            writer.emitFullString('"<Value>"');
            break;
        case LogEntryTags.OpaqueObject:
            writer.emitFullString('"<Object>"');
            break;
        case LogEntryTags.OpaqueArray:
            writer.emitFullString('"<Array>"');
            break;
        default:
            assert(false, "Unknown case in switch statement for special var emit.");
            break;
    }
}

/**
 * Create an emitter that will format/emit from a block list into the writer.
 */
function emitter_createEmitter(writer) {
    return { blockList: null, block: null, pos: 0, writer: writer, stateStack: [] };
}

/**
 * Append a new blocklist into the current one in this emitter
 */
function emitter_appendBlockList(emitter, blockList) {
    if(emitter.blockList === null) {
        emitter.blockList = blockList;
        emitter.block = blocklist.head;
        emitter.pos = 0;
    }
    else {
        assert(false, 'Need to add append code here!!!');
    }
}

/**
 * Push top level format msg state
 */
function emitter_pushFormatState(emitter, fmt) {
    emitter.stateStack.push(emitStack_createFormatterState(fmt));
}

/**
 * Push an object format msg state and write opening {
 */
function emitter_pushObjectState(emitter) {
    emitter.stateStack.push(emitStack_createJSONState(EmitModes.ObjectLevel));
    emitter.writer.emitChar("{");
}

/**
 * Push an array format msg state and write opening [
 */
function emitter_pushArrayState(emitter) {
    emitter.stateStack.push(emitStack_createJSONState(EmitModes.ArrayLevel));
    emitter.writer.emitChar('[');
}

/**
 * Peek at the top emitter stack state
 */
function emitter_peekEmitState(emitter) {
    return emitter.stateStack[emitter.stateStack.length - 1];
}

/**
 * Pop and emitter state and write any needed closing } or ] and fill in any string format text
 */
function emitter_popEmitState(emitter) {
    let pentry = emitter.stateStack.pop();
    if (pentry.mode == EmitModes.MsgFormat) {
        emitter_emitEntryEnd(emitter);
    }
    else {
        emitter.writer.emitChar(pentry.mode === EmitModes.ObjectLevel ? '}' : ']');

        let sentry = emitter_peekEmitState(emitter);
        if (sentry.mode === EmitModes.MsgFormat) {
            emitter_emitFormatMsgSpan(emitter);
        }
    }
}

/**
 * Write the msg format literal text between two format specifiers (or string end).
 */
function emitter_emitFormatMsgSpan(emitter) {
    let sentry = emitter_peekEmitState(emitter);

    let start = emitStack_getFormatRangeStart(sentry);
    let end = emitStack_getFormatRangeEnd(sentry);

    emitter.writer.emitStringSpan(sentry.format.formatString, start, end);

    sentry.formatterIndex++;
}

/**
 * Emit a value when we are in format entry mode.
 */
function emitter_emitFormatEntry(emitter, tag, data) {
    let writer = emitter.writer;
    let sentry = emitter_peekEmitState(emitter);
    let fmt = sentry.format;

    assert(sentry.mode === EmitModes.MsgFormat, "Shound not be here then.");

    if (tag === LogEntryTags.MsgEndSentinal) {
        emitter_popEmitState(emitter);
    }
    else {
        if (tag === LogEntryTags.MsgLevel) {
            //write format string to first formatter pos (or entire string if no formatters) and set the stack as needed.
            emitter_emitEntryStart(writer);

            let logLevelEntry = LoggingLevels.find(function (value) {
                return value.enum === (data & LoggingLevels.ALL);
            });

            let systemLevelEntry = SystemInfoLevels.find(function (value) {
                return value.enum === (data & SystemInfoLevels.ALL);
            });

            writer.emitFullString('level: ');
            if (logLevelEntry & systemLevelEntry) {
                writer.emitFullString('(logging: ');
                writer.emitFullString(logLevelEntry.label);
                writer.emitFullString(', system: ');
                writer.emitFullString(systemLevelEntry.label);
                writer.emitFullString(')');

            }
            else {
                if (logLevelEntry) {
                    writer.emitFullString(logLevelEntry.label);
                }
                else {
                    writer.emitFullString(systemLevelEntry.label);
                }
            }

            writer.emitFullString(', msg: ')
            if (fmt.formatterArray.length === 0) {
                writer.emitFullString(fmt.formatString);
            }
            else {
                let fpos = fmt.formatterArray[0].start;
                writer.emitStringSpan(fmt.formatString, 0, fpos);
            }
        }
        else if (tag === LogEntryTags.LParen) {
            emitter_pushObjectState(emitter);
        }
        else if (tag === LogEntryTags.LBrack) {
            emitter_pushArrayState(emitter);
        }
        else if (tag === LogEntryTags.JsBadFormatVar || tag === LogEntryTags.OpaqueValue) {
            emitter_emitSpecialVar(dataTag, writer);
        }
        else {
            switch (fentry.Tag.enum) {
                case 0x1: //#
                    writer.emitFullString('#');
                    break;
                case 0x2: //#ip_addr
                case 0x3: //#app_name
                case 0x4: //#module_name
                case 0x5: //#msg_name
                    writer.emitFullString(data);
                    break;
                case 0x6: //#wall_time
                    writer.emitFullString(data.toISOString());
                    break;
                case 0x7: //#locial_time
                case 0x8: //#callback_id
                case 0x9: //#request_id
                    writer.emitFullString(data.toString());
                    break;
                case 0x10: //$
                    writer.emitFullString('$');
                    break;
                default:
                    emitter_emitSimpleVar(data, writer);
                    break;
            }

            emitter_emitFormatMsgSpan(emitter);
        }
    }
}

/**
 * Emit a value when we are in object entry mode.
 */
function emitter_emitObjectEntry(emitter, tag, data) {
    let writer = emitter.writer;
    let sentry = emitter_peekEmitState(emitter);

    assert(sentry.mode === EmitModes.ObjectLevel, "Shound not be here then.");

    if (tag === LogEntryTags.RParen) {
        emitter_popEmitState(emitter);
    }
    else {
        if (tag === LogEntryTags.PropertyRecord) {
            if (emitStack_checkAndUpdateNeedsComma(sentry)) {
                writer.emitFullString(', ');
            }

            emitter_emitJsString(data, writer);
            writer.emitFullString(': ');
        }
        else if (tag === LogEntryTags.LParen) {
            emitter_pushObjectState(emitter);
        }
        else if (tag === LogEntryTags.LBrack) {
            emitter_pushArrayState(emitter);
        }
        else if (tag === LogEntryTags.JsVarValue) {
            emitter_emitSimpleVar(data, writer);
        }
        else {
            emitter_emitSpecialVar(tag, writer);
        }
    }
}

/**
 * Emit a value when we are in array entry mode.
 */
function emitter_emitArrayEntry(emitter, tag, data) {
    let writer = emitter.writer;
    let sentry = emitter_peekEmitState(emitter);

    assert(sentry.mode === EmitModes.ObjectLevel, "Shound not be here then.");

    if (tag === LogEntryTags.RBrack) {
        emitter_popEmitState(emitter);
    }
    else {
        if (emitStack_checkAndUpdateNeedsComma(sentry)) {
            writer.emitFullString(', ');
        }

        if (tag === LogEntryTags.LParen) {
            emitter_pushObjectState(emitter);
        }
        else if (tag === LogEntryTags.LBrack) {
            emitter_pushArrayState(emitter);
        }
        else if (tag === LogEntryTags.JsVarValue) {
            emitter_emitSimpleVar(data, writer);
        }
        else {
            emitter_emitSpecialVar(tag, writer);
        }
    }
}

/**
 * Emit a single message -- return true if more to emit false otherwise
 */
function emitter_emitMsg(emitter) {
    let state = emitter_peekEmitState(emitter).mode;
    let tag = emitter.block.tags[emitter.pos];
    let data = emitter.block.data[emitter.pos];

    if(state === EmitModes.MsgFormat) {
        emitter_emitFormatEntry(emitter, tag, data);
    }
    else if(state === EmitModes.ObjectLevel) {
        emitter_emitObjectEntry(emitter, tag, data);
    }
    else {
        emitter_emitArrayEntry(emitter, tag, data);
    }
}

/**
 * The main process loop for the emitter -- write a full message and check if drain is required + cb invoke.
 */
function emitter_ProcessLoop(emitter) {
    let flush = false;
    while (emitter.block !== null && !flush) {
        let tag = emitter.block.tags[emitter.pos];
        let data = emitter.block.data[emitter.pos];

        if(tag === LogEntryTags.MsgFormat) {
            emitter_pushFormatState(emitter, data);
        }
        else {
            emitter_emitMsg(emitter);
        }

        if(tag === LogEntryTags.MsgEndSentinal) {
            flush = emitter.writer.needsToDrain();
        }

        //Advance the position of the emitter
        if (emitter.pos < emitter.block.count - 1) {
            emitter.pos++;
        }
        else {
            emitter.block = emitter.block.next;
            emitter.pos = 0;
        }
    }

    //if we need to flush then call the writer drain with a callback to us
    if(flush) {
        emitter.writer.drain(function () {
            emitter_ProcessLoop(emitter);
        });
    }
}

/**
 * Call this method to emit a blocklist (as needed).
 */
function emitBlockList(emitter, blockList) {
    emitter_appendBlockList(blockList);
    emitter_ProcessLoop(emitter);
}

/////////////////////////////
//Code for various writer implementations

/**
 * Create a basic console writer 
 */
function createConsoleWriter() {
    let process = require('process');
    return {
        emitChar: function(c) {
            process.stdout.write(c);
        },
        emitFullString: function(str) {
            process.stdout.write(str);
        },
        emitStringSpan: function(str, start, end) {
            process.stdout.write(str.substr(start, end - start));
        },
        needsToDrain: function() {
            return false;
        },
        drain: function(cb) {
            assert(false, 'Should never be trying to drain!');
        }
    }
}

/////////////////////////////
//Exports

//Export the logging and systemlogging level enums
exports.LoggingLevels = LoggingLevels;
exports.SystemInfoLevels = SystemInfoLevels;

//Export function to create a message format from a string or object/array
exports.createMsgFormat = extractMsgFormat;

//Export function for logging a message into the in-memory logging buffer
exports.createBlockList = msgBlock_createBlockList;
exports.logMsg = logMsg;

//Export a function to filter in-memory messages into a block for emit
exports.processMsgsForWrite = processMsgsForWrite;

//Export a function for creating an emitter
exports.createEmitter = emitter_createEmitter;

//Export a function to write messages out to the given writer
exports.emitBlockList = emitBlockList;

//Create a console writer
exports.createConsoleWriter = createConsoleWriter;