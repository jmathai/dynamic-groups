/**
 * This is the boilerplate repository for creating joules.
 * Forking this repository should be the starting point when creating a joule.
 */

/*
 * The handler function for all API endpoints.
 * The `event` argument contains all input values.
 *    event.httpMethod, The HTTP method (GET, POST, PUT, etc)
 *    event.{pathParam}, Path parameters as defined in your .joule.yml
 *    event.{queryStringParam}, Query string parameters as defined in your .joule.yml
 */
var Response = require('joule-node-response')
    , JouleNodeDatabase = require('joule-node-database')
    , myDb = new JouleNodeDatabase()
    , {google} = require('googleapis')
    , jexl = require('jexl')
    , scopes = [
      'https://www.googleapis.com/auth/admin.directory.user'
      , 'https://www.googleapis.com/auth/admin.directory.group'
    ];

const authClient = new google.auth.JWT(
        process.env.CLIENT_EMAIL,
        null,
        process.env.PRIVATE_KEY,
        scopes,
        process.env.IMPERSONATE_EMAIL
      )
      , admin = google.admin('directory_v1');

jexl.addTransform('lower', function(val) {
    return val.toLowerCase();
});

var handler = function(event, context) {
	var response = new Response()
      , pathArray = event.path
      , httpMethod = event.httpMethod;
	response.setContext(context);
	response.setHeader('Access-Control-Allow-Origin', '*');

  if(pathArray.length === 0) {
    // base path is the webhook
    webhook(event, context, response);
  } else {
    switch(pathArray[0]) {
      case 'api':
        switch(httpMethod) {
          case 'DELETE':
            api_delete(event, context, response);
            break;
          case 'GET':
            api_get(event, context, response);
            break;
          case 'POST':
            api_post(event, context, response);
            break;
        }
        break;
      case 'test':
        response.send(event);
        break;
    }
  }
};

var api_get = function(event, context, response) {
  myDb.get('dynamic-groups').done(function(data) {
    var dbData = data || {};
    if(!data) {
      console.log("Error fetching database in api_get");
      console.log(data);
    }
    response.send(dbData);
  });
};

var api_post = function(event, context, response) {
  var groupKey = event.post.groupKey
      , rule = event.post.rule
      , emptyRules = {};
  myDb.get('dynamic-groups').done(function(records) {
    if(!records) {
      console.log("Error fetching database in api_post");
      console.log(records);
      records = emptyRules;
    }
    records[groupKey] = {expression: rule};
    myDb.set('dynamic-groups', records).done(function(data) {
      if(!data) {
        console.log("Error updating database in api_post");
        console.log(data);
        response.send(data);
        return;
      }
      response.send(records);
    });
  });
};

var api_delete = function(event, context, response) {
  var groupKey = event.post.groupKey;
  myDb.get('dynamic-groups').done(function(records) {
    if(!records || !records.hasOwnProperty(groupKey)) {
      console.log("Error fetching database in api_delete");
      console.log(records);
      response.setHttpCode(404);
      response.send(null);
    }
    delete records[groupKey];
    myDb.set('dynamic-groups', records).done(function(data) {
      if(!data) {
        console.log("Error updating database in api_delete");
        console.log(data);
        response.send(data);
        return;
      }
      response.send(records);
    });
  });
};


var webhook = function(event, context, response) {
  const userKey = event.post['primaryEmail'];
  memberParams = {userKey:userKey, projection: 'full', auth: authClient};
  admin.users.get(memberParams, function(err, data) {
    if (err) {
      console.log(err);
      response.send(err.response.data);
      return;
    }
    const user = data.data;

    myDb.get('dynamic-groups').done(function(groupRules) {
      if(!groupRules) {
        console.log("Error fetching database in api_get");
        console.log(err);
        response.send(err);
        return;
      }
      /*var groupRules = {
        'users-in-pm-department@nps-limited.com': {expression: '"product management" in customSchemas.OrgDetails.Department|lower'}
        , 'users-in-pm-ou@nps-limited.com': {expression: '"/Product Management" == orgUnitPath'}
      };*/
      ruleCount = 0;
      ruleTotal = Object.keys(groupRules).length;
      for(group in groupRules) {
        process_rule(group, groupRules[group].expression, user, response);
      }
    });
  });
};

var process_rule = function(group, rule, user, response) {
  ruleCount++;
  authClient.authorize(function(err, data) {
    if (err) {
			console.log(err);
      response.send(err.response.data);
      return;
    }
    
    admin.users.get(memberParams, function(err, data) {
      if (err) {
				console.log(err);
        response.send(err.response.data);
        return;
      }

      const user = data.data;

      console.log(rule);
      console.log(user);
      jexl.eval(rule, user, function(err, condition_status) {
        if(condition_status) {
          const resource = Object.assign(user, {role: 'MEMBER'});
          const insertMemberParams = {groupKey: group, resource: resource, auth: authClient};
          admin.members.insert(insertMemberParams, function(err, data) {
            if (err) {
              console.log('add_to_group err');
              //console.log(err);
              return;
            }
            console.log('add_to_group success');
            if(ruleCount === ruleTotal) {
              response.send('done'/*{"user": data.data}*/);
            }
            return;
          });
        } else {
          const deleteMemberParams = {groupKey: group, memberKey: user.id, auth: authClient};
          admin.members.delete(deleteMemberParams, function(err, data) {
            if (err) {
              console.log('remove_from_group err');
              console.log(err);
              return;
            }
            console.log('remove_from_group success');
            if(ruleCount === ruleTotal) {
              response.send('done'/*{"user": data.data}*/);
            }
            return;
          });
        }
      });
    });
  });
};

exports.handler = handler;
