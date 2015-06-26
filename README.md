nodejs-contagious
=================

A one-to-many, inotify event driven, asynchronous file system sync daemon.

# How to install

```$ npm install ```

# How It Works

Contagious uses inotify to check for file system changes, then hooks into rsync to asynchronously push those changes to specified servers.  Javascript offers several advantages to this over Java, Bash, and Python methods.  Due to its event-driven mechanics, this eliminates the need to run numerous threads.  This makes it unlikely that even a non-privileged user will hit the system limits even on watching very large file system sets.  Further, there is very little overhead at all while the daemon is running, consuming very few resources.  The asynchronous nature allows rsync tasks to be done in tandem without interrupting the inotify watcher processes, making it efficient for sync'ing a large number of files across several servers.

# Features

* One-to-many replication
* Rsync ssh-key based replication
* Recursive path watching
* Multiple path locations
* Exclude patterns

# Use Cases

This daemon was created to sync'd web server doc roots across replicated nodes to sync static files and pages.  An example being that a file is uploaded to a Wordpress instance, resulting in that file automatically being sent to the other specified nodes via rsync.  This could similarly be useful for configuration files, basic application deployments, and sync'ing software repository mirrors (deb, rpm, etc.)

# How to use

Just running the "contagious.js" is enough:

```$ nohup node contagious.js -r --path=/var/www/html --exclude=temp/,logs```

With `npm install` you should be able to run this with the "contagious" command.  Parameters can be given on command line.  Defaults can be overridden at the top of the script.  If you get an rsync SSH error, make sure you have ssh-agent running and a valid key.

# Features Wanted

* Move configuration out to separate file/env
* Integrate as system daemon (ie, systemd)
