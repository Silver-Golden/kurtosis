import {
  Box,
  Button,
  ButtonGroup,
  Flex,
  Modal,
  ModalBody,
  ModalCloseButton,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalOverlay,
} from "@chakra-ui/react";
import Dagre from "@dagrejs/dagre";
import { isDefined, KurtosisAlert, RemoveFunctions, stringifyError } from "kurtosis-ui-components";
import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { FiPlusCircle } from "react-icons/fi";
import { useNavigate } from "react-router-dom";
import {
  Background,
  BackgroundVariant,
  Controls,
  Edge,
  Node,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  useReactFlow,
  XYPosition,
} from "reactflow";
import "reactflow/dist/style.css";
import { v4 as uuidv4 } from "uuid";
import { useEnclavesContext } from "../../EnclavesContext";
import { EnclaveFullInfo } from "../../types";
import { KurtosisArtifactNode } from "./enclaveBuilder/KurtosisArtifactNode";
import { KurtosisServiceNode } from "./enclaveBuilder/KurtosisServiceNode";
import {
  generateStarlarkFromGraph,
  getInitialGraphStateFromEnclave,
  getNodeDependencies,
} from "./enclaveBuilder/utils";
import {
  KurtosisNodeData,
  useVariableContext,
  VariableContextProvider,
} from "./enclaveBuilder/VariableContextProvider";

type EnclaveBuilderModalProps = {
  isOpen: boolean;
  onClose: () => void;
  existingEnclave?: RemoveFunctions<EnclaveFullInfo>;
};

export const EnclaveBuilderModal = ({ isOpen, onClose, existingEnclave }: EnclaveBuilderModalProps) => {
  const navigator = useNavigate();
  const visualiserRef = useRef<VisualiserImperativeAttributes | null>(null);
  const { createEnclave, runStarlarkScript } = useEnclavesContext();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string>();

  const {
    nodes: initialNodes,
    edges: initialEdges,
    data: initialData,
  } = useMemo((): {
    nodes: Node<any>[];
    edges: Edge<any>[];
    data: Record<string, KurtosisNodeData>;
  } => {
    const parseResult = getInitialGraphStateFromEnclave<KurtosisNodeData>(existingEnclave);
    if (parseResult.isErr) {
      setError(parseResult.error);
      return { nodes: [], edges: [], data: {} };
    }
    return {
      ...parseResult.value,
      data: Object.entries(parseResult.value.data)
        .filter(([id, data]) => parseResult.value.nodes.some((node) => node.id === id))
        .reduce((acc, [id, data]) => ({ ...acc, [id]: data }), {} as Record<string, KurtosisNodeData>),
    };
  }, [existingEnclave]);

  const handleRun = async () => {
    if (!isDefined(visualiserRef.current)) {
      setError("Cannot run when no services are defined");
      return;
    }

    setError(undefined);
    let enclave = existingEnclave;
    let enclaveUUID = existingEnclave?.shortenedUuid;
    if (!isDefined(existingEnclave)) {
      setIsLoading(true);
      const newEnclave = await createEnclave("", "info", true);
      setIsLoading(false);

      if (newEnclave.isErr) {
        setError(`Could not create enclave, got: ${newEnclave.error}`);
        return;
      }
      if (!isDefined(newEnclave.value.enclaveInfo)) {
        setError(`Did not receive enclave info when running createEnclave`);
        return;
      }
      enclave = newEnclave.value.enclaveInfo;
      enclaveUUID = newEnclave.value.enclaveInfo.shortenedUuid;
    }

    if (!isDefined(enclave)) {
      setError(`Cannot trigger starlark run as enclave info cannot be found`);
      return;
    }

    try {
      const logsIterator = await runStarlarkScript(enclave, visualiserRef.current.getStarlark(), {});
      onClose();
      navigator(`/enclave/${enclaveUUID}/logs`, { state: { logs: logsIterator } });
    } catch (error: any) {
      setError(stringifyError(error));
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={!isLoading ? onClose : () => null} closeOnEsc={false}>
      <ModalOverlay />
      <ModalContent h={"90vh"} minW={"1300px"}>
        <ModalHeader>
          {isDefined(existingEnclave) ? `Editing ${existingEnclave.name}` : "Build a new Enclave"}
        </ModalHeader>
        <ModalCloseButton />
        <ModalBody paddingInline={"0"}>
          {isDefined(error) && <KurtosisAlert message={error} />}
          <VariableContextProvider initialData={initialData}>
            <ReactFlowProvider>
              <Visualiser
                ref={visualiserRef}
                initialNodes={initialNodes}
                initialEdges={initialEdges}
                existingEnclave={existingEnclave}
              />
            </ReactFlowProvider>
          </VariableContextProvider>
        </ModalBody>
        <ModalFooter>
          <ButtonGroup>
            <Button onClick={onClose} isDisabled={isLoading}>
              Close
            </Button>
            <Button onClick={handleRun} colorScheme={"green"} isLoading={isLoading} loadingText={"Run"}>
              Run
            </Button>
          </ButtonGroup>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
};

const g = new Dagre.graphlib.Graph().setDefaultEdgeLabel(() => ({}));

const getLayoutedElements = <T extends object>(nodes: Node<T>[], edges: Edge<any>[]) => {
  if (nodes.length === 0) {
    return { nodes, edges };
  }
  g.setGraph({ rankdir: "LR", ranksep: 100 });

  edges.forEach((edge) => g.setEdge(edge.source, edge.target));
  nodes.forEach((node) =>
    g.setNode(node.id, node as Node<{ label: string }, string | undefined> & { width?: number; height?: number }),
  );

  Dagre.layout(g);

  return {
    nodes: nodes.map((node) => {
      const { x, y } = g.node(node.id);

      return { ...node, position: { x, y } };
    }),
    edges,
  };
};

type VisualiserImperativeAttributes = {
  getStarlark: () => string;
};

type VisualiserProps = {
  initialNodes: Node<any>[];
  initialEdges: Edge<any>[];
  existingEnclave?: RemoveFunctions<EnclaveFullInfo>;
};

const Visualiser = forwardRef<VisualiserImperativeAttributes, VisualiserProps>(
  ({ initialNodes, initialEdges, existingEnclave }, ref) => {
    const { data, updateData } = useVariableContext();
    const insertOffset = useRef(0);
    const { fitView, addNodes, getViewport } = useReactFlow();
    const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes || []);
    const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges || []);

    const nodeTypes = useMemo(() => ({ serviceNode: KurtosisServiceNode, artifactNode: KurtosisArtifactNode }), []);

    const onLayout = useCallback(() => {
      const layouted = getLayoutedElements(nodes, edges);

      setNodes([...layouted.nodes]);
      setEdges([...layouted.edges]);

      window.requestAnimationFrame(() => {
        fitView();
      });
    }, [nodes, edges, fitView, setEdges, setNodes]);

    const getNewNodePosition = (): XYPosition => {
      const viewport = getViewport();
      insertOffset.current += 1;
      return { x: -viewport.x + insertOffset.current * 20 + 400, y: -viewport.y + insertOffset.current * 20 };
    };

    const handleAddServiceNode = () => {
      const id = uuidv4();
      updateData(id, { type: "service", serviceName: "", image: "", ports: [], env: [], files: [], isValid: false });
      addNodes({
        id,
        position: getNewNodePosition(),
        width: 600,
        type: "serviceNode",
        data: {},
      });
    };

    const handleAddArtifactNode = () => {
      const id = uuidv4();
      updateData(id, { type: "artifact", artifactName: "", files: {}, isValid: false });
      addNodes({
        id,
        position: getNewNodePosition(),
        width: 600,
        type: "artifactNode",
        data: {},
      });
    };

    useEffect(() => {
      setEdges((prevState) => {
        return Object.entries(getNodeDependencies(data)).flatMap(([to, froms]) =>
          [...froms].map((from) => ({
            id: `${from}-${to}`,
            source: from,
            target: to,
            animated: true,
            style: { strokeWidth: "3px" },
          })),
        );
      });
    }, [setEdges, data]);

    useImperativeHandle(
      ref,
      () => ({
        getStarlark: () => {
          return generateStarlarkFromGraph(nodes, edges, data, existingEnclave);
        },
      }),
      [nodes, edges, data, existingEnclave],
    );

    return (
      <Flex flexDirection={"column"} h={"100%"} gap={"8px"}>
        <ButtonGroup paddingInline={6}>
          <Button onClick={onLayout}>Do Layout</Button>
          <Button leftIcon={<FiPlusCircle />} onClick={handleAddServiceNode}>
            Add Service Node
          </Button>
          <Button leftIcon={<FiPlusCircle />} onClick={handleAddArtifactNode}>
            Add Artifact Node
          </Button>
        </ButtonGroup>
        <Box bg={"gray.900"} flex={"1"}>
          <ReactFlow
            minZoom={0.1}
            maxZoom={1}
            nodeDragThreshold={3}
            nodes={nodes}
            edges={edges}
            proOptions={{ hideAttribution: true }}
            onMove={() => (insertOffset.current = 1)}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            nodeTypes={nodeTypes}
            fitView
          >
            <Controls />
            <Background variant={BackgroundVariant.Dots} gap={12} size={1} />
          </ReactFlow>
        </Box>
      </Flex>
    );
  },
);