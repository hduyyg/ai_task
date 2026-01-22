#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
BaseAgent - 所有 Agent 的基类
"""

import json
import logging
import os
from abc import ABC, abstractmethod
from typing import Optional, Tuple, Union

logger = logging.getLogger(__name__)


class BaseAgent(ABC):
    """Agent 基类，定义所有 Agent 的通用接口"""
    
    def __init__(self, name: str, timeout: int = 1800):
        """
        初始化 Agent
        
        Args:
            name: Agent 名称
            timeout: 超时时间（秒），默认30分钟
        """
        self.name = name
        self.timeout = timeout
    
    def run_prompt(
        self, 
        trace_id: str,
        cwd: str,
        prompt: str, 
        timeout: Optional[int] = None,
        input_save_file_path: Optional[str] = None, 
        output_save_file_path: Optional[str] = None,
        json_parse: bool = False,
    ) -> Tuple[bool, Union[str, dict]]:
        """
        执行 prompt 并返回结果
        
        Args:
            trace_id: 追踪标识，用于日志关联
            cwd: 工作目录
            prompt: 要执行的 prompt
            timeout: 超时时间（秒），为 None 则使用默认值
            input_save_file_path: 保存输入 prompt 的文件路径，为 None 则不保存
            output_save_file_path: 保存输出 reply 的文件路径，为 None 则不保存
            json_parse: 是否对结果进行 JSON 解析，默认 False
            
        Returns:
            Tuple[bool, Union[str, dict]]: 
                - bool: 执行是否成功
                - Union[str, dict]: 成功时为结果（json_parse=True 时为 dict，否则为 str）；
                                   失败时为错误信息字符串
        """
        
        # 保存输入 prompt
        if input_save_file_path:
            self._save_to_file(input_save_file_path, prompt)
            logger.info(f"[{trace_id}] Prompt 已保存到: {input_save_file_path}")
        
        # 执行 agent 调用
        if timeout is None:
            timeout = self.timeout
        
        try:
            logger.info(f"[{trace_id}] 调用 {self.name}，工作目录: {cwd}，执行 Prompt:\n***************\n{prompt}\n***************")
            success, reply = self._execute_prompt(trace_id, cwd, prompt, timeout)
            logger.info(f"[{trace_id}] {self.name} 调用完成，执行结果: {success}")
        except Exception as e:
            error_msg = f"[{trace_id}] {self.name} 执行失败: {type(e).__name__}: {str(e)}"
            logger.error(f"[{trace_id}] {error_msg}")
            # 执行失败时也保存错误信息到 output 文件
            if output_save_file_path:
                self._save_to_file(output_save_file_path, error_msg)
                logger.info(f"[{trace_id}] {self.name} 错误信息已保存到: {output_save_file_path}")
            return False, error_msg
        
        # _execute_prompt 返回失败
        if not success:
            logger.error(f"[{trace_id}] {self.name} 执行失败: {reply}")
            if output_save_file_path:
                self._save_to_file(output_save_file_path, reply)
                logger.info(f"[{trace_id}] {self.name} 错误信息已保存到: {output_save_file_path}")
            return False, reply
        
        # 如果需要 JSON 解析
        if json_parse:
            try:
                result = json.loads(reply)
                # 保存输出 reply（原始字符串）
                if output_save_file_path:
                    self._save_to_file(output_save_file_path, reply)
                    logger.info(f"[{trace_id}] {self.name} Reply 已保存到: {output_save_file_path}")
                return True, result
            except json.JSONDecodeError as e:
                error_msg = f"[{trace_id}] {self.name} JSON 解析失败: {str(e)}\n原始内容:\n{reply}"
                logger.error(f"[{trace_id}] {error_msg}")
                # JSON 解析失败时保存错误信息到 output 文件
                if output_save_file_path:
                    self._save_to_file(output_save_file_path, error_msg)
                    logger.info(f"[{trace_id}] {self.name} 错误信息已保存到: {output_save_file_path}")
                return False, error_msg
        
        # 保存输出 reply
        if output_save_file_path:
            self._save_to_file(output_save_file_path, reply)
            logger.info(f"[{trace_id}] {self.name} Reply 已保存到: {output_save_file_path}")
        
        return True, reply
    
    @abstractmethod
    def _execute_prompt(self, trace_id: str, cwd: str, prompt: str, timeout: int) -> Tuple[bool, str]:
        """
        实际执行 prompt 的抽象方法，子类需实现
        
        Args:
            trace_id: 追踪标识，用于日志关联
            cwd: 工作目录
            prompt: 要执行的 prompt
            timeout: 超时时间（秒）
            
        Returns:
            Tuple[bool, str]: 
                - bool: 执行是否成功
                - str: 成功时为执行结果；失败时为错误信息
        """
        pass
    
    def _save_to_file(self, file_path: str, content: str) -> None:
        """
        将内容保存到文件
        
        Args:
            file_path: 文件路径
            content: 要保存的内容
        """
        # 确保目录存在
        dir_path = os.path.dirname(file_path)
        if dir_path:
            os.makedirs(dir_path, exist_ok=True)
        
        with open(file_path, 'w', encoding='utf-8') as f:
            f.write(content)
