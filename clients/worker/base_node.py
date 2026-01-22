#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
基础节点类 - 所有执行节点的基类
"""

import json
import logging
from abc import ABC, abstractmethod
from typing import Callable

from rpc.apiserver_rpc import Task
from config.config_model import ClientConfig

logger = logging.getLogger(__name__)


class BaseNode(ABC):
    """执行节点基类"""
    
    # 节点名称，子类需要重写
    node_name: str = "base"
    node_key: str = "base"
    
    def __init__(self, task: Task, client_config: ClientConfig):
        self.task = task
        self.client_config = client_config

    # ==================== Properties ====================

    @property
    def flow_status(self) -> str:
        """节点状态: pending(待处理), running(进行中), reviewing(待审核), reviewed(已审核通过), revising(修订中), done(已完成), error(异常) """
        return self.task.flow_status

    @property
    def user_feedback(self) -> str:
        """用户反馈内容，如果没有反馈则返回空字符串"""
        nodes = self.task.flow.get('nodes', [])
        if len(nodes) > 0 and nodes[-1].get('type') == 'user_feedback':
            return nodes[-1].get('content', '')
        return ''

    @property
    def task_basic_info(self) -> str:
        """任务基本信息的格式化字符串"""
        # 解析 desc JSON，提取描述内容
        desc_text = ''
        if self.task.desc:
            try:
                desc_data = json.loads(self.task.desc)
                desc_text = desc_data.get('desc', '') if isinstance(desc_data, dict) else ''
            except (json.JSONDecodeError, TypeError):
                # JSON 解析失败，忽略
                pass
        
        if desc_text:
            return f"""- 任务标题: {self.task.title}
- 任务描述: 
{desc_text}"""
        else:
            return f"- 任务标题: {self.task.title}"


    # ==================== Abstract Methods ====================

    @abstractmethod
    def execute_for_pending(self, trace_id: str):
        """执行节点逻辑 - 待处理"""
        pass

    @abstractmethod
    def execute_for_reviewed(self, trace_id: str):
        """执行节点逻辑 - 已审核通过"""
        pass

    @abstractmethod
    def execute_for_revising(self, trace_id: str):
        """执行节点逻辑 - 根据用户审核意见，进行修订"""
        pass

    @abstractmethod
    def before_execute(self, trace_id: str):
        """准备执行节点逻辑 - 准备执行节点所需的环境和数据"""
        pass

    @abstractmethod
    def after_execute(self, trace_id: str):
        """执行后处理逻辑 - 执行后处理逻辑，如保存执行信息到文件、更新任务状态等"""
        pass

    # ==================== Public Methods ====================

    def execute(self, trace_id: str):
        # 如果节点正在待处理，则直接返回
        if self.flow_status == 'pending' or self.flow_status == 'running':
            self._execute_and_persist(
                current_status=self.flow_status, 
                executing_status='running', 
                default_next_status='reviewing', 
                main_executor=self.execute_for_pending,
                trace_id=trace_id)
            return
        # 如果节点正在修订中，则执行修订中后处理逻辑
        if self.flow_status == 'revising':
            self._execute_and_persist(
                current_status=self.flow_status, 
                executing_status='revising', 
                default_next_status='reviewing', 
                main_executor=self.execute_for_revising,
                trace_id=trace_id)
            return
        # 如果节点已审核通过，则执行已审核通过的后处理逻辑
        if self.flow_status == 'reviewed':
            self._execute_and_persist(
                current_status=self.flow_status, 
                executing_status='reviewed', 
                default_next_status='done', 
                main_executor=self.execute_for_reviewed,
                trace_id=trace_id)
            return
        # 如果节点状态是在审核中、已完成、异常中，则直接返回，不需要执行
        if self.flow_status in ['reviewing', 'done', 'error', 'client_error']:
            return
        raise ValueError(f"当前节点 {self.node_name} 状态不正确: {self.flow_status}")

    def _execute_and_persist(
        self, 
        trace_id: str,
        current_status: str,
        executing_status : str,
        default_next_status: str,
        main_executor: Callable
    ):
        """
        Args:
            current_status: 当前状态 (pending/revising/reviewed)
            executing_status: 执行阶段状态 (pending/revising/reviewed)
            next_status: 正常执行结束后的下一个状态
            main_executor: 主执行函数，返回 execute_info
            post_executor: 可选的后续处理函数，返回更新字典
        """
        executor_name = main_executor.__name__
        logger.info(f"[{self.task.key}] 节点 {self.node_name} 开始执行 {executor_name}")
        
        if current_status != executing_status:
            self.client_config.apiserver_rpc.update_task_flow(task_id=self.task.id, flow_status=executing_status)

        logger.info(f"[{trace_id}] 节点 {self.node_name} 开始执行 {executor_name}: 执行环境准备")
        self.before_execute(trace_id)
        logger.info(f"[{trace_id}] 节点 {self.node_name} 开始执行 {executor_name}: 执行主逻辑")
        main_executor(trace_id)
        logger.info(f"[{trace_id}] 节点 {self.node_name} 开始执行 {executor_name}: 执行后续逻辑")
        self.after_execute(trace_id)
        # 统一更新 flow 数据和 flow_status，避免两次 RPC 调用
        self.client_config.apiserver_rpc.update_task_flow(
            task_id=self.task.id, 
            flow=self.task.flow,
            flow_status=default_next_status
        )
        logger.info(f"[{trace_id}] 节点 {self.node_name} 执行 {executor_name} 完成")
