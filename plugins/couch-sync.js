var levelCouchSync = require('level-couch-sync')
var pad            = require('padded-semver').pad
var semver         = require('semver')

exports.db = function (db, config) {
  var packageDb = db.sublevel('pkg', {valueEncoding: 'json'})
  var versionDb = db.sublevel('ver', {valueEncoding: 'json'})

  var syncRegistryUrl = config.syncRegistryUrl || 'https://skimdb.npmjs.com/registry'

  //if a date is missing, use this number.
  var yearZero = new Date(2009, 1, 1)

  if(config._[0] === 'sync')
    config.sync = true

  if(!(config && config.sync))
    return db.sublevel('registry-sync')

  var lastPercentage = 0
  var registrySync
  if(config.sync !== false) {

    registrySync = db.sublevel('registry-sync')
    levelCouchSync(syncRegistryUrl, db, registrySync,
    function (data, emit) {
      var doc = data.doc
      if(!doc) return
      if(doc._deleted) return
      
      //don't allow keys with ~
      if(/~/.test(data.id)) return

      //is a design doc
      if(!doc.name || !doc.versions) return
      if(!doc.maintainers || !doc.maintainers[0] || !doc.maintainers[0].name)
        return

      try {
        //set time to something sensible by default.
        var time = doc.time ? {
            created  : doc.time.created,
            modified : doc.time.modified
          } : {
            created  : yearZero,
            modified : yearZero
          }

        emit(data.id, {
          name        : doc.name,
          description : doc.description,
          readme      : doc.readme,
          keywords    : doc.keywords,
          author      : doc.author,
          licenses    : doc.licenses,
          repository  : doc.repository,
          maintainers : doc.maintainers,
          time        : time
        }, packageDb)


        //versions
        var vers = doc.versions
        for(var version in vers) {
          var ver = vers[version]
          var tgz = doc.name + '-' + version + '.tgz'
          emit(data.id + '!' + pad(version), {
            name            : ver.name,
            version         : ver.version,
            dependencies    : ver.dependencies,
            devDependencies : ver.devDependencies,
            description     : ver.description,
            time            : doc.time ? doc.time[version] : yearZero,
            shasum          : ver.dist.shasum,
            gypfile         : ver.gypfile
          }, versionDb)

        }
      } catch (err) {
        console.error(err.stack)
        throw err
      }
    })

  }

}

exports.cli = function (db) {
  db.cli.push(function (db, config, cb) {
    if(!config.sync) return
    console.log('syncing...')
    var registrySync = 
      db.sublevel('registry-sync')

    var whitespace = ''

    for(var i = 0; i < process.stdout.colums; i++)
      whitespace += ' '

    if(config.verbose)
      db.sublevel('pkg').post(function (op) {
        var pkg = JSON.parse(op.value)

        var maintainers = pkg.maintainers.map(function (e) {
          return e.name
        }).join(', ')
        
        console.log(pkg.name)
        if(pkg.description)
          console.log('  '+pkg.description)
      })
    else if (config.debug) {

     ;['backoff', 'ready',  'data',    'progress',
       'max',     'wait',   'timeout', 'retry',
       'confirm', 'confirm_request']
      .forEach(function (name) {
        registrySync.on(name, function () {
          var args = [].slice.call(arguments)
          args.unshift(name)
          console.log.apply(console, args)
        })
      })
    }
    else {
      registrySync.createProgressBar('npm registry', function (data) {
        var doc = data.doc
        if(!doc.versions) return
        var max = process.stdout.columns
        try {
          var s = doc.name + '@' + semver.maxSatisfying(Object.keys(doc.versions), '*', true) + ': '
          var desc = doc.description || '[no description]'
          var len = s.length + desc.length
          return len > max ? s + desc.substring(0, max - s.length) : s + desc
        } catch (err) {
          console.error(err.message)
        }
        
      })
    }
    return true
  })
}
