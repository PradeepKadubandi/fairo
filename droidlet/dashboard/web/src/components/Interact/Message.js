/*
   Copyright (c) Facebook, Inc. and its affiliates.

 * Message.js implements ASR, send the chat message, switch to the fail or back to settings view
 */

import React, { Component } from "react";
import Button from "@material-ui/core/Button";
import "./Message.css";

class Message extends Component {
  allowedStates = [
    "sent",
    "received",
    "thinking",
    "done_thinking",
    "executing",
  ];
  constructor(props) {
    super(props);
    this.initialState = {
      recognizing: false,
      enableVoice: this.props.enableVoice,
      connected: false,
      agent_replies: this.props.agent_replies,
      ellipsis: "",
      commandState: "idle",
      now: null,
      disableInput: false,
      disableStopButton: true
    };
    this.state = this.initialState;
    this.elementRef = React.createRef();
    this.bindKeyPress = this.handleKeyPress.bind(this); // this is used in keypressed event handling
    this.sendTaskStackPoll = this.sendTaskStackPoll.bind(this);
    this.receiveTaskStackPoll = this.receiveTaskStackPoll.bind(this);
    this.issueStopCommand = this.issueStopCommand.bind(this);
    this.handleAgentThinking = this.handleAgentThinking.bind(this);
    this.handleClearInterval = this.handleClearInterval.bind(this);
    this.intervalId = null;
  }

  sendTaskStackPoll() {
    console.log("Sending task stack poll");
    this.props.stateManager.socket.emit("taskStackPoll");
  }

  receiveTaskStackPoll(res) {
    var response = JSON.stringify(res);
    console.log("Received task stack poll response:" + response);
    // If we get a response of any kind, reset the timeout clock
    if (res) {
      this.setState({
        now: Date.now(),
      });
      if (!res.task) {
        console.log("no task on stack");
        // If there's no task, leave this pane
        // If it's a HIT go to error labeling, else back to Message
        if (this.props.isTurk) {
          this.props.goToQuestion(this.props.chats.length - 1);
        } else {
          // this.props.goToMessage();
          this.handleClearInterval();
        }
      } else {
        // Otherwise send out a new task stack poll after a delay
        setTimeout(() => {
          this.sendTaskStackPoll();
        }, 1000);
      }
    }
  }

  issueStopCommand() {
    console.log("Stop command issued");
    const chatmsg = "stop";
    //add to chat history box of parent
    this.props.setInteractState({ msg: chatmsg, timestamp: Date.now() });
    //log message to flask
    this.props.stateManager.logInteractiondata("text command", chatmsg);
    //socket connection
    this.props.stateManager.socket.emit("sendCommandToAgent", chatmsg);
    //update StateManager command state
    this.props.stateManager.memory.commandState = "sent";
  }

  renderChatHistory() {
    // Pull in user chats and agent replies, filter out any empty ones
    let chats = this.props.chats.filter((chat) => chat.msg !== "");
    let replies = this.state.agent_replies.filter((reply) => reply.msg !== "");
    chats = chats.filter((chat) => chat.msg);
    replies = replies.filter((reply) => reply.msg);
    // Label each chat based on where it came from
    chats.forEach((chat) => (chat["sender"] = "message user"));
    replies.forEach((reply) => (reply["sender"] = "message agent"));
    // Strip out the 'Agent: ' prefix if it's there
    replies.forEach(function (reply) {
      if (reply["msg"].includes("Agent: ")) {
        reply["msg"] = reply["msg"].substring(7);
      }
    });
    // Zip it into one list, sort by timestamp, and send it off to be rendered
    let chat_history = chats.concat(replies);
    chat_history.sort(function (a, b) {
      return a.timestamp - b.timestamp;
    });

    return chat_history.map((chat) =>
      React.cloneElement(
        <li className={chat.sender} key={chat.timestamp.toString()}>
          {chat.msg}
        </li>
      )
    );
  }

  isMounted() {
    //check if this element is being displayed on the screen
    return this.elementRef.current != null;
  }

  handleKeyPress(event) {
    if (event.key === "Enter") {
      event.preventDefault();
      this.handleSubmit();
    }
  }

  componentDidMount() {
    this.props.stateManager.connect(this);
    document.addEventListener("keypress", this.bindKeyPress);
    this.setState({ connected: this.props.stateManager.connected });
  }

  componentWillUnmount() {
    this.props.stateManager.disconnect(this);
    document.removeEventListener("keypress", this.bindKeyPress);
  }

  handleSubmit() {
    //get the message
    var chatmsg = document.getElementById("msg").value;
    if (chatmsg.replace(/\s/g, "") !== "") {
      //add to chat history box of parent
      this.props.setInteractState({ msg: chatmsg, timestamp: Date.now() });
      //log message to flask
      this.props.stateManager.logInteractiondata("text command", chatmsg);
      //log message to Mephisto
      window.parent.postMessage(
        JSON.stringify({ msg: { command: chatmsg } }),
        "*"
      );
      //send message to TurkInfo
      this.props.stateManager.sendCommandToTurkInfo(chatmsg);
      //socket connection
      this.props.stateManager.socket.emit("sendCommandToAgent", chatmsg);
      //update StateManager command state
      this.props.stateManager.memory.commandState = "sent";
      //clear the textbox
      document.getElementById("msg").value = "";
      //clear the agent reply that will be shown in the question pane
      this.props.stateManager.memory.last_reply = "";
      //change to the AgentThinking view pane if it makes sense
      if (this.props.agentType === "craftassist") {
        // this.props.goToAgentThinking();
        this.handleAgentThinking();
      }
    }
  }

  handleAgentThinking() {
    if (this.props.stateManager) {
      this.props.stateManager.socket.on(
        "taskStackPollResponse",
        this.receiveTaskStackPoll
      );
    }

    this.intervalId = setInterval(() => {
      let commandState = null;
      
      if (this.props.stateManager) {
        commandState = this.props.stateManager.memory.commandState;
        console.log("Command State from agent thinking: " + commandState);
      }

      // Check that we're in an allowed state and haven't timed out
      if (this.safetyCheck()) {
        this.setState((prevState) => {
          if (prevState.commandState !== commandState) {
            // Log changes in command state to mephisto for analytics
            window.parent.postMessage(
              JSON.stringify({ msg: commandState }),
              "*"
            );
          }
          if (prevState.ellipsis.length > 6) {
            return {
              ellipsis: "",
              commandState: commandState,
            };
          } else {
            return {
              ellipsis: prevState.ellipsis + ".",
              commandState: commandState,
            };
          }
        });
      }
    }, this.props.stateManager.memory.commandPollTime);

    this.setState({
      commandState: this.props.stateManager.memory.commandState,
      now: Date.now(),
    });
  }

  safetyCheck() {
    // If we've gotten here during idle somehow, or timed out, escape to safety
    if (
      !this.allowedStates.includes(this.state.commandState) ||
      Date.now() - this.state.now > 50000
    ) {
      console.log("Safety check failed, exiting to Message pane.");
      // this.props.goToMessage();
      this.handleClearInterval();
      return false;
    } else return true;
  }

  handleClearInterval() {
    clearInterval(this.intervalId);
    if (this.props.stateManager) {
      this.props.stateManager.disconnect(this);
      this.props.stateManager.socket.off(
        "taskStackPollResponse",
        this.receiveTaskStackPoll
      );
      this.setState({
        disableInput: false,
        agent_replies: this.props.agent_replies,
        disableStopButton: true,
      });
    }
  }

  componentDidUpdate(prevProps, prevState) {
    if (this.state.commandState !== prevState.commandState) {
      let command_message = '';
      let disableInput = true;
      let disableStopButton = this.state.disableStopButton;
      if (this.state.commandState === 'sent') {
        command_message = 'Sending command...';
        disableStopButton = true;
      } else if (this.state.commandState === 'received') {
        command_message = 'Command received';
        disableStopButton = true;
      } else if (this.state.commandState === 'thinking') {
        command_message = 'Assistant is thinking...';
        disableStopButton = true;
      } else if (this.state.commandState === 'done_thinking') {
        command_message = 'Assistant is doing the task';
        disableStopButton = false;
      } else if (this.state.commandState === 'executing') {
        command_message = 'Assistant is doing the task';
        disableStopButton = false;
      }
      if (command_message) {
        const newAgentReplies = [...this.state.agent_replies, { msg: command_message, timestamp: Date.now() }];
        this.setState({
          agent_replies: newAgentReplies,
          disableInput: disableInput,
          disableStopButton: disableStopButton
        });
      }
    }
  }

  render() {
    return (
      <div>
        <div>
          <p>
            Enter the command to the assistant in the input box below, then
            press 'Enter'.
          </p>
        </div>
        <div className="center">
          <div className="chat">
            <div className="time">
              Assistant is{" "}
              {this.state.connected === true ? (
                <span style={{ color: "green" }}>connected</span>
              ) : (
                <span style={{ color: "red" }}>not connected</span>
              )}
            </div>
            <div className="messages">
              <ul className="messagelist" id="chat">
                {this.renderChatHistory()}
              </ul>
            </div>
            <div className="input">
              <input
                id="msg"
                placeholder={this.state.disableInput ? `Waiting for Assistant${this.state.ellipsis}` : "Type your command here"}
                type="text"
                disabled={this.state.disableInput}
              />
              <Button
                variant="contained"
                color="primary"
                onClick={this.issueStopCommand.bind(this)}
                className="stop-button"
                disabled={this.state.disableStopButton}
              >
                Stop
              </Button>

            </div>
          </div>
        </div>
      </div>
    );
  }
}

export default Message;

