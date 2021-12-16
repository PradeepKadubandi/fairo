#!/usr/bin/env python3

# Copyright (c) Facebook, Inc. and its affiliates.
# This source code is licensed under the MIT license found in the
# LICENSE file in the root directory of this source tree.

import argparse
import os

from mephisto.abstractions.databases.local_database import LocalMephistoDB
from mephisto.tools.data_browser import DataBrowser
from mephisto.data_model.worker import Worker

def main(run_id, performance_dir) -> list:
    # Import bonus list, formatted "$Worker $Bonus" each line, and convert to dict
    bonus_path = os.path.join(performance_dir, "performance_bonuses.txt")
    with open(bonus_path, "r") as f:
            bonus_list = f.readlines()
    bonus_dict = {}
    for bonus in bonus_list:
        turker = bonus.split(' ')[0]
        amount = float(bonus.split(' ')[1][:-1])
        if turker in bonus_dict:
            bonus_dict[turker].append(amount)
        else: bonus_dict[turker] = [amount]
    print(bonus_dict)

    # Get completed units from the run_id
    db = LocalMephistoDB()
    units = db.find_units(task_run_id=run_id)
    completed_units = []
    for unit in units:
        if unit.db_status == "completed":
            completed_units.append(unit)

    #Issue bonuses and return the results
    data_browser = DataBrowser(db=db)
    bonus_results = []
    for unit in completed_units:
        data = data_browser.get_data_from_unit(unit)
        worker = Worker(db, data["worker_id"])
        if worker.worker_name in bonus_dict:  #Edge case that a worker completed a HIT with no score reported
            amount = bonus_dict[worker.worker_name].pop(0) # Order doesn't really matter here, but they should be filled and popped the same
            bonus_result, _ = worker.bonus_worker(amount, "Virtual assistant interaction quality bonus", unit)
            bonus_results.append(bonus_result)

    print(bonus_results)
    return bonus_results


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--run_id", type=int, help="integer mephisto run ID", required=True)
    parser.add_argument("--performance_dir", type=str, help="directory containing 'performance_bonuses.txt'", required=True)
    args = parser.parse_args()

    main(args.run_id, args.performance_dir)