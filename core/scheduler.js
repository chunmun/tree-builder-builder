/*
  Copyright 2015 Google Inc. All Rights Reserved.
  Licensed under the Apache License, Version 2.0 (the "License");
  you may not use this file except in compliance with the License.
  You may obtain a copy of the License at
      http://www.apache.org/licenses/LICENSE-2.0
  Unless required by applicable law or agreed to in writing, software
  distributed under the License is distributed on an "AS IS" BASIS,
  WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
  See the License for the specific language governing permissions and
  limitations under the License.
*/

var Promise = require('bluebird');
var assert = require('chai').assert;

var taskQueue = [];
var maxWaiting = 32;
var waitCount = 0;

function Task(phases, index, stream, resolve) {
  this.phases = phases;
  this.index = index;
  this.stream = stream;
  this.dependencies = [];
  this.executingDependencies = 0;
  this.resolve = resolve;
  this.waitingFor = [];
  this.finished = false;
}

Task.prototype = {
  dependenciesRemain: function() {
    return this.dependencies.length + this.executingDependencies > 0;
  },
  /**
   * A task waits for another task by recording the waitee in the waitingFor
   * list.
   */
  waitFor: function(task) {
    this.waitingFor = task.waitingFor;
    task.waitingFor = [];
    this.waitingFor.push(task);
  },
  /**
   * When a task is finished, it checks to see if all the tasks it is waiting
   * for are finished too. If they are, it can call resolve.
   *
   * If not, rather than busy looping, the task transfers its resolve method
   * and waitingFor list to one of the unfinished tasks.
   *
   * Note: only one task in any set of related tasks can have a resolve method -
   * this is the task that must have the list of waitingFor tasks too.
   * Transferring one requires transferring both.
   */
  resolveTask: function() {
    this.finished = true;
    this.waitingFor = this.waitingFor.filter(function(task) { return !task.finished; });
    if (this.waitingFor.length == 0) {
      this.resolve && this.resolve();
      return;
    }
    var newWaitingTask = this.waitingFor.pop();
    newWaitingTask.waitingFor = this.waitingFor;
    newWaitingTask.resolve = this.resolve;
    this.resolve = undefined;
    this.waitingFor = undefined;
  }
}

function runPhases(phases) {
  var initPhases = phases
      .map(function(phase, idx) { return {phase: phase, idx: idx} })
      .filter(function(phase) { return phase.phase.init !== undefined; });

  var finishedPromiseList = [];

  return Promise.all(initPhases.map(function(phase) {
    return phase.phase.init(function(stream) {
      var promise = new Promise(function(resolve, reject) {
        schedule(phases, phase.idx + 1, stream, resolve);
      });
      finishedPromiseList.push(promise);
    });
  })).then(function() { return Promise.all(finishedPromiseList).then(function() { })});

}

function schedule(phases, index, stream, resolve) {
  taskQueue.push(new Task(phases, index, stream, resolve));
  startTasks();
}

function startTasks() {
  var deferred = [];
  while (taskQueue.length && waitCount < maxWaiting) {
    var task = taskQueue.pop();
    if (task.index == task.phases.length && !task.dependenciesRemain()) {
      task.resolveTask();
      continue;
    }
    if (runDependency(task) || runPhase(task))
      waitCount++;
    else
      deferred.push(task);
  }
  deferred.forEach(function(task) { taskQueue.push(task); });
}

function done() {
  waitCount--;
  startTasks();
}

function runDependency(task) {
  if (task.dependencies.length > 0) {
    var dependency = task.dependencies.pop();
    task.executingDependencies++;
    dependency().then(function() {
      task.executingDependencies--;
      done();
    });
    if (task.dependenciesRemain())
      taskQueue.push(task);
    return true;
  }
  return false;
}

var doneCmd = 'done';
var parCmd = 'par';
var yieldCmd = 'yield';

function runPhase(task) {
  if (task.dependenciesRemain())
    return false;
  var oldIndex = task.index;
  task.phases[task.index].impl(task.stream).then(function(op) {
    if (op.command == parCmd) {
      task.dependencies = op.dependencies;
    } else if (op.command == yieldCmd) {
      var newTask = new Task(task.phases, oldIndex, task.stream, task.resolve);
      task.resolve = undefined;
      newTask.waitFor(task);
      taskQueue.push(newTask);
      task.stream = op.stream;
    }
    task.index++;
    taskQueue.push(task);
    done();
  });
  return true;
}

module.exports.runPhases = runPhases;
