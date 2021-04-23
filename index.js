//const appsync = require('aws-appsync');
//const gql = require('graphql-tag');
//const env = require('process').env;
require('cross-fetch/polyfill');
const fetch = require('node-fetch');
const URL = require('url'); 
var AWS = require("aws-sdk");

// ------------------------------------------------------------------------------
//              Variabili e costanti globali 
// ------------------------------------------------------------------------------

AWS.config.update({
    region: "eu-central-1"
});

var AccessKeyId, SecretAccessKey, SessionToken;
var sts = new AWS.STS({
    apiVersion: '2011-06-15'
}); 
// riferimento procedimento: https://cloudonaut.io/calling-appsync-graphql-from-lambda/

// riferimento descrizione parametri: https://docs.aws.amazon.com/STS/latest/APIReference/API_AssumeRole.html
var paramsSession = { 
    RoleArn: "arn:aws:iam::942766427804:role/LambdaToAppSync", // Il ruolo si chiama: LambdaToAppSync
    RoleSessionName: Math.floor(Math.random() * 999999999999999).toString()
};

const uri = URL.parse("https://wrr2rnchnne5lkcqhnzwyukwhq.appsync-api.eu-central-1.amazonaws.com/graphql");
const httpRequest = new AWS.HttpRequest(uri.href, "eu-central-1");
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
    if(err) console.log(err)
    const signer = new AWS.Signers.V4(httpRequest, "appsync", true);
    signer.addAuthorization(AWS.config.credentials, AWS.util.date.getDate());

    const options = {
        method: httpRequest.method,
        body: httpRequest.body,
        headers: httpRequest.headers
    };

    const response = await fetch(uri.href, options)
    console.log(await response.json())
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


    /*_items = [
        {   PlayerId:"efgfesefesffeg",Name:"Marco",CreateAt:48742323},
        {   PlayerId:"sdrgatyutyutyututyutu",Name:"Gianpaolo",CreateAt:59887332},
        {   PlayerId:"nnnnnnnnnnnnnnnnnn",Name:"Luca",CreateAt:23746424},
        {   PlayerId:"wewewewweweweewe",Name:"Thomas",CreateAt:86526323},
        {   PlayerId:"qqqqqqqqqqqqqqqqq",Name:"Calgaro",CreateAt:56451461},
        {   PlayerId:"tttttttthhhhhhtttttt",Name:"Giovannino",CreateAt:33463765},
        {   PlayerId:"nkonkonkonko",Name:"Figaro",CreateAt:66565563},
        {   PlayerId:"drgdrgdrgdrgdrgrdgdr",Name:"ui",CreateAt:59887332},
        {   PlayerId:"gggggggg",Name:"hj",CreateAt:23746424},
        {   PlayerId:"ttrtrtrtrtrtrtr",Name:"gh",CreateAt:86526323},
        {   PlayerId:"iiiiiiiiiii",Name:"fg",CreateAt:56451461},
        {   PlayerId:"ooooooooooffffff",Name:"df",CreateAt:33463765},
        {   PlayerId:"klklkklklkklklklk",Name:"sd",CreateAt:66565563}];*/

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
        region: 'eu-central-1',
        credentials: new AWS.Credentials(AccessKeyId, SecretAccessKey, SessionToken)
    });

    // ------------------------------------------------------------------------------
    //      Trasferimento dei Giocatori nel Database delle Partite
    // ------------------------------------------------------------------------------  

    
    
    var codeGame;
    for (let i = 0; i < _items.length; i++) {

        if (i % 6 == 0) {
            codeGame = uuidv4();
            let err = await ApplyMutation({
                query: `mutation CreateGameRoom($input: CreateGameRoomInput!) {
                            createGameRoom(input: $input) {
                                id
                                seed
                                gamers
                            }
                        }`,
                operationName: "CreateGameRoom",
                variables: {
                    input: {
                        id: codeGame,
                        gamers: _items.length < i + 6 ? _items.length - i : 6,
                        seed: Math.floor(Math.random() * 99999)
                    }
                }
            });
            if(err) console.log(err)
        }

        let err = await ApplyMutation({
            query: `
                mutation CreatePlayer($input: CreatePlayerInput!) {
                  createPlayer(input: $input){
                    createdAt
                    dead
                    gameid
                    id
                    lastinteraction
                    name
                    positionX
                    positionY
                    score
                    updatedAt
                    gameroom {
                      createdAt
                      gamers
                      id
                      seed
                      updatedAt
                      players {
                        items {
                          createdAt
                          dead
                          gameid
                          id
                          lastinteraction
                          name
                          positionX
                          positionY
                          score
                          updatedAt
                          gameroom {
                            createdAt
                            gamers
                            id
                            seed
                            updatedAt
                          }
                        }
                      }
                    }
                  }
                }`,
            operationName: "CreatePlayer",
            variables: {
                input: {
                    lastinteraction: Date.now(), 
                    name: _items[i].Name,
                    score: 0,
                    id: _items[i].PlayerId,
                    gameid: codeGame,
                    positionX: 0.5,
                	positionY: 0,
                	dead: false
                }
            }
        });
        
        if(err) console.log(err)

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