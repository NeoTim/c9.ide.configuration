define(function(require, exports, module) {
    main.consumes = [
        "Plugin", "dialog.error", "ui", "settings", "tabManager", "save", 
        "menus", "preferences.keybindings", "preferences.general",
        "preferences.project", "c9", "commands", "watcher", "fs"
    ];
    main.provides = ["configure"];
    return main;

    function main(options, imports, register) {
        var Plugin = imports.Plugin;
        var settings = imports.settings;
        var commands = imports.commands;
        var save = imports.save;
        var menus = imports.menus;
        var watcher = imports.watcher;
        var tabManager = imports.tabManager;
        var ui = imports.ui;
        var c9 = imports.c9;
        var fs = imports.fs;
        var kbprefs = imports["preferences.keybindings"];
        var genprefs = imports["preferences.general"];
        var prjprefs = imports["preferences.project"];
        var showError = imports["dialog.error"].show;
        
        var join = require("path").join;
        
        /***** Initialization *****/
        
        var plugin = new Plugin("Ajax.org", main.consumes);
        // var emit = plugin.getEmitter();
        
        var cssSession = new Plugin("Ajax.org", main.consumes);
        var services;
        
        var loaded = false;
        function load() {
            if (loaded) return false;
            loaded = true;
            
            // Init Script
            var script = settings.get("user/config/init.js");
            if (script) {
                c9.once("ready", function(){
                    try { eval(script); }
                    catch (e){ showError("Error Executing init.js: ", e.message); }
                });
            }
            
            // Init CSS
            var css = settings.get("user/config/styles.css");
            if (css)
                ui.insertCss(css, false, cssSession);
            
            commands.addCommand({
                name: "restartc9",
                group: "General",
                bindKey: { mac: "Command-R", win: "Ctrl-R" },
                exec: function(){
                    location.reload();
                }
            }, plugin);
            
            menus.addItemByPath("Cloud9/~", new ui.divider(), 350, plugin);
            menus.addItemByPath("Cloud9/Open Your Project Settings", new ui.item({
                onclick: editProjectSettings
            }), 400, plugin);
            menus.addItemByPath("Cloud9/Open Your User Settings", new ui.item({
                onclick: editUserSettings
            }), 400, plugin);
            menus.addItemByPath("Cloud9/Open Your Keymap", new ui.item({
                onclick: function(){
                    kbprefs.editUserKeys();
                }
            }), 600, plugin);
            menus.addItemByPath("Cloud9/Open Your Init Script", new ui.item({
                onclick: editInitJs
            }), 700, plugin);
            menus.addItemByPath("Cloud9/Open Your Stylesheet", new ui.item({
                onclick: editStylesCss
            }), 800, plugin);
            
            menus.addItemByPath("Cloud9/Restart Cloud9", new apf.item({
                command: "restartc9"
            }), 2000080, plugin);
            
            genprefs.on("edit", function(){
                editUserSettings(); 
            })
            prjprefs.on("edit", function(){
                editProjectSettings();
            })
            
            save.on("beforeSave", function(e) {
                if (!e.document.meta.config) return;
                
                var path = e.document.meta.config;
                
                // Doing save as, it is now a normal document
                if (e.path != path) {
                    delete e.document.meta.config;
                    delete e.document.meta.nofs;
                    return;
                }
                
                if (path == "~/.c9/init.js") {
                    settings.setJson("user/config/init.js", e.document.value);
                    showError("Please reload for these changes to take effect.");
                }
                else if (path == "~/.c9/styles.css") {
                    var css = e.document.value;
                    settings.setJson("user/config/styles.css", css);
                    
                    cssSession.cleanUp();
                    ui.insertCss(css, false, cssSession);
                }
                else if (path == settings.paths.project) {
                    try { var project = JSON.parse(e.document.value); }
                    catch (e) { 
                        showError("Syntax Error in Project Settings: " + e.message); 
                        return false;
                    }
                    
                    // @todo doesn't update UI
                    // settings.model.project = project;
                    settings.read({ project: project });
                    settings.save(true);
                }
                else if (path == settings.paths.user) {
                    try { var user = JSON.parse(e.document.value); }
                    catch (e) { 
                        showError("Syntax Error in User Settings: " + e.message); 
                        return false;
                    }
                    
                    // @todo doesn't update UI
                    // settings.model.user = user;
                    settings.read({ user: user });
                    settings.save(true);
                }
                
                delete e.document.meta.newfile;
                e.document.undoManager.bookmark();
                
                return false;
            }, plugin);
            
            // Load initial project settings from disk and match against latest from database
            var initWatcher;
            settings.on("read", function(){
                fs.readFile(settings.paths.project, function(err, data){
                    if (!initWatcher) {
                        // Keep project file consistent with changes on disk
                        watcher.watch(settings.paths.project);
                        watcher.on("change", function(e){
                            if (e.path == settings.paths.project) {
                                fs.readFile(e.path, function(err, data){
                                    if (err) return;
                                    
                                    try { var json = JSON.parse(data); }
                                    catch(e) { return; }
                                    
                                    settings.read({ project: json });
                                });
                            }
                        });
                        initWatcher = true;
                    }
                    
                    if (err) return;
                    
                    try { var json = JSON.parse(data); }
                    catch(e) { return; }
                    
                    // Do nothing if they are the same
                    if (JSON.stringify(settings.model.project) == JSON.stringify(json))
                        return;
                    
                    // Compare key/values (assume source has same keys as target)
                    (function recur(source, target, base){
                        for (var prop in source) {
                            if (prop == "json()") {
                                settings.setJson(base, source[prop]);
                            }
                            else if (typeof source[prop] == "object") {
                                recur(source, target, join(base, prop));
                            }
                            else if (source[prop] != target[prop]) {
                                settings.set(join(base, prop), source[prop]);
                            }
                        }
                    })(json, settings.model.project, "");
                });
            });
        }
        
        /***** Methods *****/
        
        function openTab(path, value, syntax, defaultValue) {
            tabManager.open({
                path: path,
                value: value || defaultValue,
                active: true,
                editorType: "ace",
                document: {
                    ace: { customSyntax: syntax },
                    meta: { config: path, newfile: !value.length, nofs: true }
                }
            }, function(err, tab) {
                
            });
        }
        
        function editInitJs(){
            var script = settings.get("user/config/init.js") || "";
            openTab("~/.c9/init.js", script, "javascript", 
                "// You can access plugins via the services global variable\n");
        }
        
        function editStylesCss(){
            var css = settings.get("user/config/styles.css") || "";
            openTab("~/.c9/styles.css", css, "css");
        }
        
        function editProjectSettings(){
            var value = JSON.stringify(settings.model.project, 0, "    ")
                .replace(/"true"/g, "true")
                .replace(/"false"/g, "false");
            openTab(settings.paths.project, value, "javascript");
        }
        function editUserSettings(){
            var value = JSON.stringify(settings.model.user, 0, "    ")
                .replace(/"true"/g, "true")
                .replace(/"false"/g, "false");
            openTab(settings.paths.user, value, "javascript");
        }
        
        /***** Lifecycle *****/
        
        plugin.on("load", function() {
            load();
        });
        plugin.on("enable", function() {
            
        });
        plugin.on("disable", function() {
            
        });
        plugin.on("unload", function() {
            loaded = false;
        });
        
        /***** Register and define API *****/
        
        /**
         * 
         **/
        plugin.freezePublicAPI({
            get services(){ return services; },
            set services(value){ services = value; },
            
            /**
             * 
             */
            editInitJs: editInitJs,
            
            /**
             * 
             */
            editStylesCss: editStylesCss,
            
            /**
             * 
             */
            editProjectSettings: editProjectSettings,
            
            /**
             * 
             */
            editUserSettings: editUserSettings
        });
        
        register(null, {
            configure: plugin
        });
    }
});