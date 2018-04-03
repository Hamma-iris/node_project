// Dependencies
var fs = require("fs");
var rimraf = require("rimraf");
var mkdirp = require("mkdirp");
var multiparty = require('multiparty');
var fileInputName = process.env.FILE_INPUT_NAME || "qqfile"; //By default, the name of this parameter is qquuid
var publicDir = process.env.PUBLIC_DIR || 'C:/Users/XPS/upload';
var nodeModulesDir = process.env.NODE_MODULES_DIR || '/';
var uploadedFilesPath = process.env.UPLOADED_FILES_DIR || 'C:/Users/XPS/node_project/uploaded_files/';
var chunkDirName = "chunks";
var maxFileSize = process.env.MAX_FILE_SIZE || 0; // in bytes, 0 for unlimited
// load up the user model
var saveuplodedfile_model = require('../app/models/saveuplodedfile');
exports.onUploadFile = function(req, res){

function onUpload(req, res) {
    var form = new multiparty.Form();

    form.parse(req, function(err, fields, files) {
        var partIndex = fields.qqpartindex;

        // text/plain is required to ensure support for IE9 and older
        res.set("Content-Type", "text/plain");

        if (partIndex == null) {
            onSimpleUpload(fields, files[fileInputName][0],"id", res);
        }
        else {
            onChunkedUpload(fields, files[fileInputName][0],"id", res);
        }
    });
}

function onSimpleUpload(fields, file, patient_id, res) {
    var uuid = fields.qquuid,
        responseData = {
            success: false
        };

    file.name = fields.qqfilename;

    if (isValid(file.size)) {
        moveUploadedFile(file, uuid, function() {
                responseData.success = true;
				var new_saveuplodedfile_model = new saveuplodedfile_model();
				// set the user's local credentials
                new_saveuplodedfile_model.path    = uploadedFilesPath + uuid + "/";
				new_saveuplodedfile_model.patient_id    = patient_id;
                new_saveuplodedfile_model.originalname = file.name;

                // save the user
                new_saveuplodedfile_model.save(function(err) {
                    if (err)
                        throw err;
                     res.send(responseData);
                });
               
            },
            function() {
                responseData.error = "Problem copying the file!";
                res.send(responseData);
            });
    }
    else {
        failWithTooBigFile(responseData, res);
    }
}

function onChunkedUpload(fields, file, patient_id, res) {
    var size = parseInt(fields.qqtotalfilesize),
        uuid = fields.qquuid,
        index = fields.qqpartindex,
        totalParts = parseInt(fields.qqtotalparts),
        responseData = {
            success: false
        };

    file.name = fields.qqfilename;

    if (isValid(size)) {
        storeChunk(file, uuid, index, totalParts, function() {
            if (index < totalParts - 1) {
                responseData.success = true;
                var new_saveuplodedfile_model = new saveuplodedfile_model();
				// set the user's local credentials
                new_saveuplodedfile_model.path    = uploadedFilesPath + uuid + "/";
				new_saveuplodedfile_model.patient_id    = patient_id;
                new_saveuplodedfile_model.originalname = file.name;

                // save the user
                new_saveuplodedfile_model.save(function(err) {
                    if (err)
                        throw err;
                     res.send(responseData);
                });
            }
            else {
                combineChunks(file, uuid, function() {
                        responseData.success = true;
                        var new_saveuplodedfile_model = new saveuplodedfile_model();
				        // set the user's local credentials
                        new_saveuplodedfile_model.path    = uploadedFilesPath + uuid + "/";
				        new_saveuplodedfile_model.patient_id    = patient_id;
                        new_saveuplodedfile_model.originalname = file.name;

                        // save the user
                        new_saveuplodedfile_model.save(function(err) {
                            if (err)
                                throw err;
                             res.send(responseData);
                        });
                    },
                    function() {
                        responseData.error = "Problem conbining the chunks!";
                        res.send(responseData);
                    });
            }
        },
        function(reset) {
            responseData.error = "Problem storing the chunk!";
            res.send(responseData);
        });
    }
    else {
        failWithTooBigFile(responseData, res);
    }
}

function failWithTooBigFile(responseData, res) {
    responseData.error = "Too big!";
    responseData.preventRetry = true;
    res.send(responseData);
}

function isValid(size) {
    return maxFileSize === 0 || size < maxFileSize;
}

function moveFile(destinationDir, sourceFile, destinationFile, success, failure) {
    mkdirp(destinationDir, function(error) {
        var sourceStream, destStream;

        if (error) {
            console.error("Problem creating directory " + destinationDir + ": " + error);
            failure();
        }
        else {
            sourceStream = fs.createReadStream(sourceFile);
            destStream = fs.createWriteStream(destinationFile);

            sourceStream
                .on("error", function(error) {
                    console.error("Problem copying file: " + error.stack);
                    destStream.end();
                    failure();
                })
                .on("end", function(){
                    destStream.end();
                    success();
                })
                .pipe(destStream);
        }
    });
}

function moveUploadedFile(file, uuid, success, failure) {
    var destinationDir = uploadedFilesPath + uuid + "/", //var destinationDir = uploadedFilesPath+"/" +drId+ "/"+PateintID+"/" + uuid + "/",
        fileDestination = destinationDir + file.name;

    moveFile(destinationDir, file.path, fileDestination, success, failure);
}

function storeChunk(file, uuid, index, numChunks, success, failure) {
    var destinationDir = uploadedFilesPath + uuid + "/" + chunkDirName + "/",
        chunkFilename = getChunkFilename(index, numChunks),
        fileDestination = destinationDir + chunkFilename;

    moveFile(destinationDir, file.path, fileDestination, success, failure);
}

function combineChunks(file, uuid, success, failure) {
    var chunksDir = uploadedFilesPath + uuid + "/" + chunkDirName + "/",
        destinationDir = uploadedFilesPath + uuid + "/",
        fileDestination = destinationDir + file.name;


    fs.readdir(chunksDir, function(err, fileNames) {
        var destFileStream;

        if (err) {
            console.error("Problem listing chunks! " + err);
            failure();
        }
        else {
            fileNames.sort();
            destFileStream = fs.createWriteStream(fileDestination, {flags: "a"});

            appendToStream(destFileStream, chunksDir, fileNames, 0, function() {
                rimraf(chunksDir, function(rimrafError) {
                    if (rimrafError) {
                        console.log("Problem deleting chunks dir! " + rimrafError);
                    }
                });
                success();
            },
            failure);
        }
    });
}

function appendToStream(destStream, srcDir, srcFilesnames, index, success, failure) {
    if (index < srcFilesnames.length) {
        fs.createReadStream(srcDir + srcFilesnames[index])
            .on("end", function() {
                appendToStream(destStream, srcDir, srcFilesnames, index + 1, success, failure);
            })
            .on("error", function(error) {
                console.error("Problem appending chunk! " + error);
                destStream.end();
                failure();
            })
            .pipe(destStream, {end: false});
    }
    else {
        destStream.end();
        success();
    }
}

function getChunkFilename(index, count) {
    var digits = new String(count).length,
        zeros = new Array(digits + 1).join("0");

    return (zeros + index).slice(-digits);
}  

onUpload(req, res);

}

exports.DeleteFile = function(req, res){

function onDeleteFile(req, res) {
    var uuid = req.params.uuid,
        dirToDelete = uploadedFilesPath + uuid;

    rimraf(dirToDelete, function(error) {
        if (error) {
            console.error("Problem deleting file! " + error);
            res.status(500);
        }

        res.send();
    });
}

onDeleteFile(req, res);

}