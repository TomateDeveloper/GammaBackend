"use strict";

const Match = require("@match");
const moment = require("moment");
const Gamemode = require("@gamemode");
const Party = require("@party");
const Promise = require("bluebird");
const Server = require("@server");

module.exports = {

  gamemode_list: function(req, res) {
    Gamemode.find().select({sub_types: 0, _id: 0}).exec((err, gamemodes) => {
      if (err || !gamemodes) return res.status(200).send({query_success: false});
      return res.status(200).send({query_success: true, gamemodes: gamemodes});
    });
  },

  match_create: function(req, res) {
    const params = req.body;
    if (params.map && params.teams && params.gamemode && params.sub_gamemode) {
      let match = new Match();
      match.map = params.map;
      match.teams = params.teams;
      match.status = "waiting";
      match.gamemode = params.gamemode;
      match.created_at = moment().unix();
      match.sub_gamemode = params.sub_gamemode;
      match.save((err, saved_match) => {
        if (err || !saved_match) return res.status(200).send({query_success: false});
        Server.findOne({_id: req.server.sub}, (err, server) => {
          if (err || !server) return res.status(200).send({query_success: false});
          if (server.played_matches + 1 > server.max_total) {
            Match.findOneAndDelete({_id: saved_match._id}, (err) => {
              if (err) return res.status(200).send({query_success: false});
              return res.status(200).send({query_success: false, exceeded_total: true});
            });
          } else if (server.max_running < server.matches.length + 1) {
            Match.findOneAndDelete({_id: saved_match._id}, (err) => {
              if (err) return res.status(200).send({query_success: false});
              return res.status(200).send({query_success: false, exceeded_running: true});
            });
          } else {
            Server.findOneAndUpdate({_id: server._id}, {played_matches: server.played_matches+1,$push: {matches: saved_match._id}}, {new: true}, (err, updated_server) => {
              if (err || !updated_server) return res.status(200).send({query_success: false});
              if (updated_server.played_matches >= updated_server.max_total) return res.status(200).send({query_success: true, restart: true, match: saved_match._id});
              Match.find({_id: {$ne: saved_match._id}, gamemode: saved_match.gamemode, sub_gamemode: saved_match.sub_gamemode, status: "waiting"}, (err, remaining_match) => {
                if (err) return res.status(200).send({query_success: false});
                if (remaining_match && remaining_match.length >= 1) {
                  return res.status(200).send({query_success: true, match: saved_match._id, can_idle: true});
                } else {
                  return res.status(200).send({query_success: true, match: saved_match._id});
                }
              });
            });
          }
        });
      });
    } else {
      return res.status(200).send({query_success: false});
    }
  },

  match_find: function(req, res) {
    let params = req.body;
    if (params.gamemode && params.sub_gamemode) {
      let query = {};
      if (params.map) {
        query = {gamemode: params.gamemode, sub_gamemode: params.sub_gamemode, map: params.map};
      } else {
        query = {gamemode: params.gamemode, sub_gamemode: params.sub_gamemode};
      }
      Gamemode.findOne({_id: params.gamemode, "sub_types.name": params.sub_gamemode}, (err, gamemode) => {
        if (err || !gamemode) return res.status(200).send({query_success: false, message: "gameapi_error"});
        Party.findOne({$or: [{leader: req.user.sub}, {"members.user": req.user.sub}]}, (err, joined_party) => {
          if (err) return res.status(200).send({query_success: false, message: "gameapi_error"});
          if (!joined_party || (joined_party && joined_party.leader.toString() === req.user.sub.toString())) {
            let joinable_members; if (joined_party) { joinable_members = joined_party.members.length + 1 } else { joinable_members = 1;}
            Match.find(query).sort("created_at").exec((err, found_match) => {
              if (err) return res.status(200).send({query_success: false, message: "gameapi_error"});
              if (found_match && found_match.length >= 1) {
                Server.findOne({matches: found_match[0]._id}, (err, server) => {
                  if (err || !server) return res.status(200).send({query_success: false, message: "gameapi_error"});
                  let gamemode_info = gamemode.sub_types.filter(sub => { return sub.name === params.sub_gamemode; })[0];
                  if (joined_party && gamemode_info.max_players < joinable_members) return res.status(200).send({query_success: false, message: "gameapi_party_exceded"});
                  if (joinable_members < (gamemode_info.max_players - server.players.length)) {
                    return res.status(200).send({query_success: true, server_found: server.slug, match_found: found_match[0]._id});
                  } else {
                    Server.find({gamemode: params.gamemode, sub_gamemode: params.sub_gamemode}).sort("started_at").exec(async (err, available_servers) => {
                      if (err) return res.status(200).send({query_success: false, message: "gameapi_error"});
                      if (available_servers && available_servers.length >= 1) {
                        let final_available = await Promise.map(available_servers, (server) => {
                          if ((server.played_matches + 1 <= server.max_total) || (server.matches.length + 1 <= server.max_running)) return server._id;
                        });
                        return res.status(200).send({query_success: true, server_found: final_available[0].slug, new_match: true, new_map: params.map});
                      } else {
                        return res.status(200).send({query_success: true, require_server: true, new_map: params.map});
                      }
                    });
                  }
                });
              } else {
                Server.find({gamemode: params.gamemode, sub_gamemode: params.sub_gamemode}).sort("started_at").exec(async (err, available_servers) => {
                  if (err) return res.status(200).send({query_success: false, message: "gameapi_error"});
                  if (available_servers && available_servers.length >= 1) {
                    let final_available = await Promise.map(available_servers, (server) => {
                      if ((server.played_matches + 1 <= server.max_total) || (server.matches.length + 1 <= server.max_running)) return server._id;
                    });
                    return res.status(200).send({query_success: true, server_found: final_available[0].slug, new_match: true, new_map: params.map});
                  } else {
                    return res.status(200).send({query_success: true, require_server: true, new_map: params.map});
                  }
                });
              }
            });
          } else {
            return res.status(200).send({query_success: false, message: "gameapi_notleader"});
          }
        });
      });

    } else {
      return res.status(200).send({query_success: false, message: "gameapi_error"});
    }
  }

};