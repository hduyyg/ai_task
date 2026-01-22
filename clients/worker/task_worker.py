#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
任务处理线程 - 总入口
"""

import logging
import threading
import time

from config.config_model import ClientConfig
from rpc import Task
from worker import CodeDevelopNode

logger = logging.getLogger(__name__)


class TaskWorker(threading.Thread):
    """任务处理线程"""
    
    def __init__(self, task: Task, config: ClientConfig):
        super().__init__(name=task.key, daemon=True)
        self.task = task
        self.config = config
        self.stopped = False

    def run(self):
        """执行任务处理逻辑"""
        task_key = self.task.key
        logger.info(f"[{task_key}] 开始处理任务: {self.task.title}")
        
        while not self.stopped:                
            try:
                # 初始化
                self.task = self.config.apiserver_rpc.get_task(self.task.id)
                if 'error' in self.task.flow_status:
                    continue
                self.config.sync_config()
                CodeDevelopNode(task=self.task, client_config=self.config).execute(trace_id=task_key)
            except Exception as e:
                logger.error(f"[{task_key}] 任务处理异常: {e}", exc_info=True)
                self.task.flow_status = "client_error"
                self.task.flow['error'] = str(e)
                self.config.apiserver_rpc.update_task_flow(task_id=self.task.id, flow_status="client_error", flow=self.task.flow)
            finally:
                # 使用可中断的等待方式
                for _ in range(5):
                    if self.stopped:
                        break
                    time.sleep(1)
        
        logger.info(f"[{task_key}] 任务线程已停止")

    def stop(self):
        """停止任务处理"""
        self.stopped = True