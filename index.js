//                 LIBRARIES AND TECHNOLOGY USED:
//    1. NODE and express.js
//    2. Packages Used: 
//       1. dotenv -> for parsing data from .env file
//       2. googleapis -> official google apis for interacting with google services in this case with gmail API
//       3. nodemon -> for development purposes
//
//
//                 SCOPE OF IMPROVEMENT
//    1. Can improve in the error handling scenario.
//    2. Code readability can be improved.
//    3. Optimization of code is possible.
//    4. Can optimized the flow of program. 
//    5. Response messages can be better.

const express = require("express");
require("dotenv").config();
const { google } = require("googleapis");
const url = require("url");
const fetch = require("node-fetch");

const app = express();

const oauth2Client = new google.auth.OAuth2(
  process.env.CLIENT_ID,
  process.env.CLIENT_SECRET,
  process.env.REDIRECT_URL
);

//Logging in a user with its google account
app.get("/login", (_req, res) => {
  // generate a url that asks permissions for User Info and Gmail scopes
  const scopes = [
    "https://www.googleapis.com/auth/gmail.compose",
    "https://www.googleapis.com/auth/gmail.modify",
    "https://www.googleapis.com/auth/userinfo.email",
    "https://www.googleapis.com/auth/userinfo.profile",
  ];

  const url = oauth2Client.generateAuthUrl({
    // 'online' (default) or 'offline' (gets refresh_token)
    access_type: "offline",

    // If you only need one scope you can pass it as a string
    scope: scopes,
  });
  res.redirect(url);
});

app.get("/oauth2callback", async (req, res) => {
  try {
    // Receive the callback from Google's OAuth 2.0 server.
    if (req.url.startsWith("/oauth2callback")) {
      // Handle the OAuth 2.0 server response
      let q = url.parse(req.url, true).query;
      // Get access and refresh tokens (if access_type is offline)
      let { tokens } = await oauth2Client.getToken(q.code);
      oauth2Client.setCredentials(tokens);
      //User Information
      const userDetails = await userInfo(tokens);
      const lableIds = await createLabel(oauth2Client, userDetails.email);
      // Repeat  in Random intervals between 45 and 120 seconds
      const timeInterval = Math.floor(Math.random() * (120 - 45 + 1)) + 45;
      console.log(`Replying to mails in: ${timeInterval} seconds`)
      setInterval(
        getMails,
        timeInterval * 1000,
        oauth2Client,
        userDetails.email,
        lableIds
      );
      res.send(tokens);
    } else {
      res.send("Error");
    }
  } catch (error) {
    console.log("err", error);
  }
});

//Creating a label named Auto-Reply and Replied
async function createLabel(auth, email) {
  const gmail = google.gmail({ version: "v1", auth });
  const labels = await gmail.users.labels.list({
    userId: email,
  });
  let result = [];
  let repliedExist = false,
    autoReplyExist = false;
  //Checking if these labels already exist or else create a new label
  for (const label of labels.data.labels) {
    if (label.name === "Auto-Reply") {
      autoReplyExist = true;
      result.push({ autoReply: label.id });
    }
    if (label.name === "Replied") {
      repliedExist = true;
      result.push({ replied: label.id });
    }
  }
  if (autoReplyExist === false) {
    const label = await gmail.users.labels.create({
      userId: email,
      resource: {
        labelListVisibility: "labelShow",
        messageListVisibility: "show",
        name: "Auto-Reply",
      },
    });
    result.push({ autoReply: label.data.id });
  } else if (repliedExist === false) {
    const label = await gmail.users.labels.create({
      userId: email,
      resource: {
        labelListVisibility: "labelHide",
        messageListVisibility: "hide",
        name: "Replied",
      },
    });
    result.push({ replied: label.data.id });
  }
  return result;
}

//This function gets all the mails and check if any reply is given and then automatic reply to the mails
async function getMails(auth, email, lableIds) {
  console.log("Ready to Reply");
  const gmail = google.gmail({ version: "v1", auth });
  //checking if any mail has been replied by the user
  const repliedMails = await gmail.users.messages.list({
    userId: email,
    q: `from:${email} newer_than:1h`,
  });
  //if any replied mails marked them with label of replied
  if (repliedMails.data.messages !== undefined) {
    repliedMails.data.messages.forEach(async (value) => {
      return await gmail.users.threads.modify({
        userId: email,
        id: value.threadId,
        resource: {
          addLabelIds: [`${lableIds[1].replied}`],
        },
      });
    });
  } else {
    //else proceed for replying by getting unreplied mails
    const unrepliedMails = await gmail.users.messages.list({
      userId: email,
      q: `-from:${email} newer_than:1h`,
    });
    console.log(unrepliedMails.data.messages);
    if (unrepliedMails.data.messages) {
      //getting the mail details
      return await unrepliedMails.data.messages.forEach(async (value) => {
        const mailDetails = await gmail.users.messages.get({
          userId: `${email}`,
          id: value.id,
        });
        const mail = mailDetails.data;
        const hasReplied = mail.payload.headers.some(
          (header) => header.name === "In-Reply-To"
        );
        if (!hasReplied) {
          //Replying to the mail
          await gmail.users.messages.send({
            userId: "me",
            resource: {
              threadId: mail.threadId,
              id: mail.id,
              raw: Buffer.from(
                `To: ${
                  mail.payload.headers.find((header) => header.name === "From")
                    .value
                }\r\n` +
                  `Subject: Re: ${
                    mail.payload.headers.find(
                      (header) => header.name === "Subject"
                    ).value
                  }\r\n` +
                  `Content-Type: text/plain; charset="UTF-8"\r\n` +
                  `Content-Transfer-Encoding: 7bit\r\n\r\n` +
                  `Thank you for your email. I'm currently on vacation and will reply to you when I return.\r\n`
              ).toString("base64"),
            },
          });
          //modifying the label to auto reply
          await gmail.users.threads.modify({
            auth,
            userId: "me",
            id: mail.threadId,
            resource: {
              addLabelIds: [lableIds[0].autoReply],
              removeLabelIds: ["INBOX"],
            },
          });
        } else {
          return;
        }
      });
    } else {
      return "No Un-Replied Emails";
    }
  }
}

//This function retreieves the user information from the token after login
async function userInfo(token) {
  const access_token = token.access_token;
  const res = await fetch(
    `https://www.googleapis.com/oauth2/v3/userinfo?access_token=${access_token}`
  );
  const resJson = await res.json();
  return resJson;
}

const port = process.env.PORT;
app.listen(port, () => {
  console.log(`Server is running at port ${port}`);
});
