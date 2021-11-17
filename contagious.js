#!/usr/bin/env node

/**    
 *  Copyright (C) 2014 Claremont McKenna College, Scott A. Williams <sawilliams@cmc.edu>
 *
 *  This program is free software: you can redistribute it and/or modify
 *  it under the terms of the GNU General Public License as published by
 *  the Free Software Foundation, either version 3 of the License, or
 *  (at your option) any later version.

 *  This program is distributed in the hope that it will be useful,
 *  but WITHOUT ANY WARRANTY; without even the implied warranty of
 *  MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 *  GNU General Public License for more details.

 *  You should have received a copy of the GNU General Public License
 *  along with this program.  If not, see <http://www.gnu.org/licenses/>. **/

// Set our default parameters
var keyfile = '';
var verbose = false;
var recursive = true;
var paths = ['.'];
var exclude = [];
var servers = [''];
var user = 'root';

// Initialize our dependent modules
var Path = require('path');
var fs = require('fs');
var Async = require('async');
var Rsync = require('rsync');
var Inotify = require('inotify').Inotify;
inotify = new Inotify();
default_config = function(path){
	return {path: path,
			watch_for: Inotify.IN_DELETE | Inotify.IN_MOVED_TO | Inotify.IN_CLOSE_WRITE,
			callback: dirwatch(path)
	};
};

// Declare Functions
//
// Watch a directory

function addwatcher(path,conf){
	// Add all paths to tracking
	if (pathchk(path)){
		var config = conf(Path.resolve(path));
		inotify.addWatch(config);
	}
}

// Event handler for when things get updated
function dirwatch(parent_path){
	return function(event){
		var name = event.name;
		var mask = event.mask;
		if (mask & Inotify.IN_Q_OVERFLOW){
			// Nothing more we can do now.  Let's get out of here.
			console.log('Ran out of watchers!  Check `sysctl -n fs.inotify.max_user_watches` for more info.');
			process.exit(1);
		}
		if (!name){
			return;
		}
		var path = parent_path + '/' + name;
		if (!pathchk(path)){
			return;
		}
		if (mask & Inotify.IN_ISDIR && mask & Inotify.IN_CREATE) {
			inotify.addWatch(default_config(path));
		}
		if (mask){
			switch (mask){
				case Inotify.IN_DELETE:
					msg = " was deleted."
					break;
				case Inotify.IN_MODIFY:
					msg = " was modified."
					break;
				case Inotify.IN_CREATE:
					msg = " was created."
					break;
				default:
					msg = " was changed in some sort of way."
			}
		}
		(verbose) ? console.log(path + msg) : '';
		// Sync this change with all servers in the list
		syncpool(parent_path);
	}
}

// Recurse directories
var dive = function (dir,callback) {
	// Assert that it's a function
	if (typeof action !== "function")
		action = function (error, file) { };

	// Read the directory
	fs.readdir(dir, function (err, list) {
		// Return the error if something went wrong
		if (err) callback(err);
	
  		// For every file in the list
		list.forEach(function (file) {
			// Full path of that file
			var path = dir + "/" + file;
			// Get the file's stats
			fs.stat(path, function (err, stat) {
				// If the file is a directory
				if (stat && stat.isDirectory() && pathchk(path)){
					addwatcher(path,default_config);
					// Dive into the directory
					dive(path, function(){});
				}
			  });
		  }); 
	});
	setTimeout(function(){
		callback(null, dir);
	}, 3000);
};

// Read params from command line
function parseconfs(){
	var args = process.argv;
	args.splice(0,2);
	function processconf(arg){
		if (arg){
			if (arg == '-h'){
				usage();
			}else if (arg == '-v'){
				verbose = true;
			}else if (arg == '-r'){
				recursive = true;
			}else if (arg.split('=')[0] == '--path'){
				paths = arg.split('=')[1].split(',');
			}else if (arg.split('=')[0] == '--exclude'){
				exclude = arg.split('=')[1].split(',');
			}else if (arg.split('=')[0] == '--server'){
				servers = arg.split('=')[1].split(',');
			}else if (arg.split('=')[0] == '--user'){
				user = arg.split('=')[1];
			}else if (arg.split('=')[0] == '--sshkey'){
				keyfile = arg.split('=')[1];
			// Exit if we don't know what to do
			}else{
				usage("Option \"" + arg.split("=")[0] + "\" was not recognized.");
			}
			processconf(args.shift());
		}else{
			// You can't sync without a destination
			(servers.length <1) ? usage("Please specify at least one server.") : setwatchers();
		}
	}
	// Ignore the first two	
	processconf(args.shift());
}
	
// Check if path is in exclude list
function pathchk(path){
	for (i=0;i<exclude.length;i++){
		if (path.indexOf(exclude[i]) != -1){
			return false;
		}
	}
	return true;
}

// Asynchronously walk and add watchers resursively on each path
function resync(dirs){
	if (verbose) console.log("Finding sub-directories.");
	function success(err, results){
		(err) ? console.log(err) :  console.log('All sub-directories were successfully added!');
	}
	Async.map(dirs,dive,success);
}

// Handler for recursive watching
function rpaths(){
	if (verbose) console.log('Adding recursive paths.');
	var results = [];
	var ppaths = paths.slice(0);
	function parsepath(path){
		if (path){
			if (verbose) console.log('Processing path ' + path);
			var prspath = Path.resolve(path);
			addwatcher(prspath,default_config);
			results.push(prspath);
			parsepath(ppaths.shift());
		}else{
			if (verbose) console.log('All paths resolved.');
			return resync(results);
		}
	}
	parsepath(ppaths.shift());
}

// Set Watchers 
function setwatchers(){
	// If recursive, find all the subdirectories
	if (recursive) {
		rpaths();
	}else{
		// Completely async since we don't care at this point
		for (i=0;i<paths.length;i++){
			var path = Path.resolve(paths[i]);
			addwatcher(path,default_config);
		}
	}	
}

// Basic rsync handler
function sync(srvpath,cb){
	var rsync = new Rsync()
  	.shell('ssh -i ' + keyfile)
  	.flags('az')
  	.set('delete')
  	.source(srvpath.split(':')[1])
  	.destination(user + '@' + srvpath);
	if (verbose){
		rsync.flags += 'v';
		console.log('Starting sync on ' + srvpath);
	}
	// Execute the command
  	return rsync.execute(function(error, code, cmd) {
		if (error){
			cb('RsyncError','WARNING: Error with syncing ' + srvpath + '.  ' + error + ' using command ' + cmd);
		}else{
			cb(null, srvpath + ' was successfully synced.  Using command: ' + cmd);
		}
	});
}

// Sync pool
// The uses async to put rsync tasks in the background
function syncpool(path){
	var synclist = [];
	var slist = servers.slice(0);
	
	// Parse the path for rsync
	function srvpathprs(server){
		if (server) {
			synclist.push(server + ':' + path + '/');
			srvpathprs(slist.shift());
		}else{
			syncall(synclist);
		}
	}
	
	// Handle the asynchronous rsync calls
	function syncall(synclist){
		Async.map(synclist,sync,function (err,results){
			if (err){
				console.log(results);
			}else if(verbose){
				for (i=0;i<results.length;i++){
					console.log(results[i]);
				}
			}
		});
	}
	srvpathprs(slist.shift());
}

// Print usage
function usage(error){
	msg = 'Contagious.js Usage\n\n'
	+ '-h           Display this help text\n'
	+ '-v           Verbose output\n'
	+ '-r           Recursively watch directories (Deprecated.  Kept for compatibility.)\n'
	+ '--path=      Comma delimited paths: /home/foo,/var/www/html\n'
	+ '             Current directory implied if omitted\n'
	+ '--exclude=   Comma delimited paths to be excluded: temp-write,.log\n'
	+ '--server=    Comma delimited servers: myserver.com,168.0.0.144\n'
	+ '--user=      SSH user name (root implied if omitted)\n'
	+ '--sshkey=    Path to SSH key\n';
	msg += (typeof error !== 'undefined') ? '\n' + error : '';
	console.log(msg);
	(typeof error !== 'undefined') ? process.exit(1) : process.exit(0);
}

// Main Process
//
// Parse arguments and go from there
parseconfs();

