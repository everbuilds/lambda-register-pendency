const appsync = require('aws-appsync');
const gql = require('graphql-tag');
require('cross-fetch/polyfill');
const env = require('process').env;
const fetch = require('node-fetch');
const URL = require('url');

// ------------------------------------------------------------------------------
//              Variabili e costanti globali 
// ------------------------------------------------------------------------------

var AWS = require("aws-sdk");
AWS.config.update({
    region: "us-east-2"
});

var AccessKeyId, SecretAccessKey, SessionToken;
var sts = new AWS.STS({
    apiVersion: '2011-06-15'
}); // riferimento procedimento: https://cloudonaut.io/calling-appsync-graphql-from-lambda/

var paramsSession = { // riferimento descrizione parametri: https://docs.aws.amazon.com/STS/latest/APIReference/API_AssumeRole.html
    //ExternalId: "123ABC", 
    RoleArn: "arn:aws:iam::942766427804:role/LambdaToAppSync", // Il ruolo si chiama: LambdaToAppSync
    RoleSessionName: Math.floor(Math.random() * 999999999999999).toString()
};

const uri = URL.parse("https://2shhhoywgnc7ninn5rdh573gce.appsync-api.us-east-2.amazonaws.com/graphql");
const httpRequest = new AWS.HttpRequest(uri.href, env.REGION);
httpRequest.headers.host = uri.host;
httpRequest.headers['Content-Type'] = 'application/json';
httpRequest.method = 'POST';

// ------------------------------------------------------------------------------
//              Funzioni Globali 
// ------------------------------------------------------------------------------

console.log('Loading function');

function uuidv4() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
        var r = Math.random() * 16 | 0,
            v = c == 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

async function ApplyMutation(bodyMutation) {
    httpRequest.body = JSON.stringify(bodyMutation);

    let err = await AWS.config.credentials.get();
    const signer = new AWS.Signers.V4(httpRequest, "appsync", true);
    signer.addAuthorization(AWS.config.credentials, AWS.util.date.getDate());

    const options = {
        method: httpRequest.method,
        body: httpRequest.body,
        headers: httpRequest.headers
    };

    await fetch(uri.href, options).then(res => res.json()).then(json => {}).catch(err => {
        console.log("Error", err, "on options: ", options);
    });
}

// ------------------------------------------------------------------------------
//              Funzione Triggherata
// ------------------------------------------------------------------------------


exports.handler = async (event, context) => {
    var ddbFrom = new AWS.DynamoDB({
        apiVersion: "2012-08-10"
    });

    var paramsFrom = {
        TableName: "LobbyRegistration",
        ProjectionExpression: "PlayerId, #Name, CreateAt",
        ExpressionAttributeNames: {
            "#Name": "Name"
        }
    };

    const _items = [];

    let data = await ddbFrom.scan(paramsFrom).promise()

    data.Items.forEach(function(item) {
        _items.push({
            PlayerId: item.PlayerId.S,
            Name: item.Name.S,
            CreateAt: item.CreateAt.N
        });
    });

    var numPlayerRest = _items.length % 6;

    _items.sort(function(a, b) {
        return a.CreateAt - b.CreateAt
    });
    

    if (numPlayerRest == 1) {
        _items.pop(); // Bisogna escludere i giocatori in eccesso o in difetto (NO Sessioni vuote o con 1 giocatore)
    }

    // ------------------------------------------------------------------------------
    //      Creazione di una Sessione per Credenziali Temporanee
    // ------------------------------------------------------------------------------

    
    await sts.assumeRole(paramsSession, function(err, data) { // Riferimento a assumeRole in SDK : https://docs.aws.amazon.com/AWSJavaScriptSDK/latest/AWS/STS.html#assumeRole-property
        if (err) console.log("Errore di assumeRole", err); // an error occurred
        else {
            AccessKeyId = data.Credentials.AccessKeyId;
            SecretAccessKey = data.Credentials.SecretAccessKey;
            SessionToken = data.Credentials.SessionToken;
        } // successful response
    }).promise();
    AWS.config.update({
        region: 'us-east-2',
        credentials: new AWS.Credentials(AccessKeyId, SecretAccessKey, SessionToken)
    });


    // ------------------------------------------------------------------------------
    //      Trasferimento dei Giocatori nel Database delle Partite
    // ------------------------------------------------------------------------------  

    
    var codeGame;
    for (let i = 0; i < _items.length; i++) {

        if (i % 6 == 0) {
            codeGame = uuidv4();
            await ApplyMutation({
                query: `mutation CreateGameRoom($input: CreateGameRoomInput!) {
                            createGameRoom(input: $input) {
                                id
                                }
                            }`,
                operationName: "CreateGameRoom",
                variables: {
                    input: {
                        id: codeGame
                    }
                }
            });
        }

        await ApplyMutation({
            query: `mutation 
            CreatePlayer($input: CreatePlayerInput!) {
                createPlayer(input: $input){
                    lastinteraction
                    name
                    score
                    id
                    gameid
                    gameroom {
                      id
                    }
                    createdAt
                    updatedAt
                }
            }`,
            operationName: "CreatePlayer",
            variables: {
                input: {
                    lastinteraction: 1000000000000, // Data Inizio di default
                    name: _items[i].Name,
                    score: 0,
                    id: _items[i].PlayerId,
                    gameid: codeGame
                }
            }
        });

        var paramsDelete = {
            Key: {
                "PlayerId": {
                    S: _items[i].PlayerId
                }
            },
            TableName: "LobbyRegistration"
        };

        await ddbFrom.deleteItem(paramsDelete, function(err, data) { 
            if (err) console.log("Delete for ", _items[i], " gone wrong Bro ;(", err);
        }).promise();
    }


    return;
};