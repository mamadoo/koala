/**
 * UglifyJS compiler
 */

'use strict';

var fs          = require('fs'),
    path        = require('path'),
    FileManager = global.getFileManager(),
    Compiler    = require(FileManager.appScriptsDir + '/Compiler.js');

function UglifyJSCompiler(config) {
    Compiler.apply(this, arguments);
}
require('util').inherits(UglifyJSCompiler, Compiler);
module.exports = UglifyJSCompiler;

var _getImports = function (srcFile) {
    //match imports from code
    var reg = /@koala-(prepend|append)\s+["']([^.]+?|.+?js)["']/g,
        result, type, importPath,

        //get fullpath of imports
        dirname = path.dirname(srcFile),
        fullPathImports = {prepend: [], append: []},

        code = fs.readFileSync(srcFile, 'utf8');

    while ((result = reg.exec(code)) !== null) {
        type = result[1];
        importPath = result[2];
        if (path.extname(importPath) !== '.js') {
            importPath += '.js';
        }

        importPath = path.resolve(dirname, importPath);

        if (fs.existsSync(importPath)) {
            fullPathImports[type].push(importPath);
        }
    }

    //global.debug(fullPathImports);
    return fullPathImports;
};

var getCombinedFile = function (filePath, importedFiles, deepImports) {
    if (typeof importedFiles === "undefined") {
        importedFiles = [];
    }

    if (importedFiles.indexOf(filePath) !== -1) {
        return [];
    }
    var prepend = [],
        append  = [],
        files   = _getImports(filePath);

    importedFiles.push(filePath);
    deepImports.push(files);

    files.prepend.forEach(function (importedFilePath) {
        if (importedFiles.indexOf(importedFilePath) === -1) {
            prepend.push.apply(prepend, getCombinedFile(importedFilePath, importedFiles, deepImports));
        }
    });

    files.append.forEach(function (importedFilePath) {
        if (importedFiles.indexOf(importedFilePath) === -1) {
            append.push.apply(append, getCombinedFile(importedFilePath, importedFiles, deepImports));
        }
    });

    return prepend.concat(filePath, append);
};

var _getDeepImportedFiles = function (deepImports) {
    var files = [];
    
    deepImports.forEach(function (item) {
        files = files.concat(item.append, item.prepend);

    });

    var files2 = [];
    
    files.forEach(function (item) {
        if (files2.indexOf(item) === -1) {
            files2.push(item);
        }
    });

    return files2;
}

/**
 * compile js file
 * @param  {Object} file      compile file object
 * @param  {Object} emitter  compile event emitter
 */
UglifyJSCompiler.prototype.compile = function (file, emitter) {
    //compile file by use system command
    var globalSettings = this.getGlobalSettings();
    this.compileWithLib(file, emitter);
}

/**
 * compile js file with node lib
 * @param  {Object} file      compile file object
 * @param  {Object} handlers  compile event handlers
 */
UglifyJSCompiler.prototype.compileWithLib = function (file, emitter) {
    var deepImports = [],
        files = getCombinedFile(file.src, [], deepImports),

        triggerError = function (message) {
            emitter.emit('fail');
            emitter.emit('always');

            this.throwError(message, file.src);
        }.bind(this),
        
        minify = function () {
            var UglifyJS = require('uglify-js'),
                options  = file.settings,
                code;
            try {
                if (options.compress) {
                    code = UglifyJS.minify(files, {fromString: true}).code;
                } else {
                    code = files.join('\n\n');
                }
                // write output
                fs.writeFile(file.output, code, "utf8", function (err) {
                    if (err) {
                        triggerError(err.message);
                    } else {
                        this.watchImports(_getDeepImportedFiles(deepImports), file.src);
                        emitter.emit('done');
                        emitter.emit('always');
                    }
                }.bind(this));
            } catch (err) {
                triggerError(err.message);
            }
        }.bind(this),

        abort = false,
        numberOfRemainingFiles = files.length,
        gotCode = function (err, code) {
            if (err) {
                abort = true;
                return triggerError(err.message);
            }

            files[this] = code;
            numberOfRemainingFiles--;
            if (numberOfRemainingFiles === 0) {
                minify();
            }
        },

        index;

    // read code
    for (index = 0; index < files.length && !abort; index++) {
        fs.readFile(files[index], "utf8", gotCode.bind(index));
    }
};