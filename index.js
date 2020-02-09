
// Requirements
var twit = require('twit')
var http = require('http')
var username = process.env.TWITTERBOT_USERNAME
var language = process.env.TWITTERBOT_LANGUAGE
var debug = process.env.TWITTERBOT_DEBUG || false

//
var retweetQuery = process.env.TWITTERBOT_RETWEET_QUERY || ''
var retweetInterval = parseInt(process.env.TWITTERBOT_RETWEET_INTERVAL) || 15

//
var favoritesQuery = process.env.TWITTERBOT_FAVORITES_QUERY || ''
var favoritesInterval = parseInt(process.env.TWITTERBOT_FAVORITES_INTERVAL) || 15

// Audit and logs holder
var audit = {
  started: new Date().toISOString(),
  username: username,
  language: language,
  retweet_query: retweetQuery,
  retweet_interval: retweetInterval,
  favorites_query: favoritesQuery,
  favorites_interval: favoritesInterval,
  logs: []
}

// Create a web server for audit and log inspection:
http.createServer(function (req, res) {
  res.write(JSON.stringify(audit));
  res.end();
}).listen(process.env.PORT || 3000);

// Prepare Twit config keys
var config = {
  consumer_key: process.env.TWITTERBOT_CONSUMER_KEY,
  consumer_secret: process.env.TWITTERBOT_CONSUMER_SECRET,
  access_token: process.env.TWITTERBOT_ACCESS_TOKEN,
  access_token_secret: process.env.TWITTERBOT_ACCESS_TOKEN_SECRET,
  timeout_ms: 300 * 1000
}

// Check username.
if (!username) {
  return writeLog('FAIL', 'You must fill bot useraname')
}

// Check config values was filled.
if (!config.consumer_key || !config.consumer_secret || !config.access_token || !config.access_token_secret) {
  return writeLog('FAIL', 'You must fill your environment variables')
}

// We need to include our configuration file
var twitter = new twit(config)

// A user stream
var stream = twitter.stream('statuses/filter', { track: '@' + username })

// When someone follows the user
stream.on('follow', followed)
stream.on('tweet', tweetEvent)

// In this callback we can see the name and screen name
function followed (event) {
  var name = event.source.name
  var screenName = event.source.screen_name
  var response = 'Thanks for following me, ' + name + ' @' + screenName + '. See also ' + getHashTags(retweetQuery)
  twitter.post('statuses/update', { status: response }, tweeted)
  writeLog.log('INFO', 'I was followed by: ' + name + ' @' + screenName)
}

// Here a tweet event is triggered!
function tweetEvent (tweet) {
  var reply_to = tweet.in_reply_to_screen_name || ''
  var name = tweet.user.screen_name
  var txt = tweet.text
  writeLog('INFO', `Event: reply_to=${reply_to}, @${name} ${txt}`)
  if (reply_to === username) {
    txt = txt.replace(new RegExp('@' + username, 'g'), '')
    var reply = 'Hi @' + name + ', Thanks for the mention. See also ' + getHashTags(retweetQuery)
    writeLog('INFO', 'Reply to say thanks: ' + reply)
    twitter.post('statuses/update', { status: reply }, tweeted)
  }
}

// This function finds the latest tweet with the #hashtag, and retweets it.
function retweetLatest () {
  // This is the URL of a search for the latest tweets on the #hashtag.
  var search = {
    q: parseQuery(retweetQuery),
    count: parseInt(process.env.TWITTERBOT_RETWEET) || 1,
    result_type: 'recent'
  }
  if (language) { search.lang = language; }
  writeLog('INFO', `Retweet by: '${search.q}', count=${search.count}, result_type=${search.result_type}`)
  twitter.get('search/tweets', search, function (error, data) {
    if (error) {
      return writeLog('FAIL', 'Retweet search fail:' + error.message)
    }
    if (!data.statuses.length) {
      writeLog('FAIL', `Retweet missing topic: '${search.q}'`)
      var link = 'https://twitter.com/search?q=' + encodeURIComponent(search.q) + '&f=live'
      var response = `Missing topic ${search.q} visit ${link}`
      return twitter.post('statuses/update', { status: response }, tweeted)
    }
    var tweets = data.statuses
    for (var i = 0; i < tweets.length; i++) {
      writeLog('INFO', 'Retweet: ID=' + tweets[i].id_str + ' ' + tweets[i].text.replace(/\s+/g, ' ').trim())
      var retweetId = tweets[i].id_str
      twitter.post('statuses/retweet/' + retweetId, {}, tweeted)
      followUser(tweets[i].user.screen_name)
    }
  })
}

// Make sure it worked!
function tweeted (err, reply) {
  if (err !== undefined) {
    writeLog('FAIL', 'Tweet error: ' + err.message)
  } else {
    writeLog('INFO', 'Tweeted done: ID=' + reply.id_str)
  }
}

// This function finds the latest tweet with the #hashtag, and retweets it.
function favoritesLatest () {
  // This is the URL of a search for the latest tweets on the #hashtag.
  var search = {
    q: parseQuery(favoritesQuery),
    count: parseInt(process.env.TWITTERBOT_FAVORITES) || 1,
    result_type: 'recent'
  }
  if (language) { search.lang = language; }
  writeLog('INFO', `Favorites by: '${search.q}', count=${search.count}, result_type=${search.result_type}`)
  twitter.get('search/tweets', search, function (error, data) {
    if (error) {
      return writeLog('FAIL', 'Favorites search fail:' + error.message)
    }
    if (!data.statuses.length) {
      return writeLog('FAIL', `Favorites missing topic: '${search.q}'`)
    }
    var tweets = data.statuses
    for (var i = 0; i < tweets.length; i++) {
      writeLog('INFO', 'Favorites: ID=' + tweets[i].id_str + ' ' + tweets[i].text.replace(/\s+/g, ' ').trim())
      var favoritesId = tweets[i].id_str
      twitter.post('favorites/create', { id: favoritesId }, favorited)
      followUser(tweets[i].user.screen_name)
    }
  })
}

// Make sure it worked!
function favorited (err, reply) {
  if (err !== undefined) {
    writeLog('FAIL', 'Favorites error: ' + err.message)
  } else {
    writeLog('INFO', 'Favorites done: ID=' + reply.id_str)
  }
}

// Follow the user by screen name
function followUser(screenName) {
  twitter.post('friendships/create', { screen_name: screenName }, function(err, resp) {
    if (err !== undefined) {
      writeLog('FAIL', `Follow user error for '${screenName}': ${err.message}`)
    } else {
      console.log(resp)
      writeLog('INFO', `Follow user done for '${screenName}'`)
    }
  })
}

// Parse query
function parseQuery(query) {
  var parsedQuery = []
  var fixedTokens = query.split(/\s*,\s*/g)
  for (var i in fixedTokens) {
    var shuffleTokens = fixedTokens[i].split(/\s*\|\s*/g)
    parsedQuery.push(shuffleTokens[Math.floor(Math.random() * shuffleTokens.length)])
  }
  return parsedQuery.filter((elem, pos) => parsedQuery.indexOf(elem) == pos).join(' ')
}

// Write logs to audit
function writeLog(type, message) {
  var timestamp = new Date().toISOString()
  console.log(`${timestamp} [${type}] ${message}`)
  audit.logs.push({ type: type, timestamp: timestamp, message: message })
  while (audit.logs.length > 100) audit.logs.shift();
}

// Get all hashtag into string
function getHashTags(inputText) {
  var regex = /(?:^|\s)(?:#)([a-zA-Z\d]+)/gm;
  var matches = [];
  var match;
  while ((match = regex.exec(inputText))) {
    matches.push('#' + match[1]);
  }
  return matches.join(' ');
}

// Try to retweet something as soon as we run the program...
retweetLatest()

// Repeat retweet by interval
setInterval(retweetLatest, 1000 * 60 * retweetInterval)

// Try to retweet something as soon as we run the program...
favoritesLatest()

// Repeat retweet by interval
setInterval(favoritesLatest, 1000 * 60 * favoritesInterval)
