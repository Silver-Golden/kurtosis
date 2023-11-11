import { Button, Menu, MenuButton } from "@chakra-ui/react";
import { FiPlus } from "react-icons/fi";
import { useNavigate } from "react-router-dom";
import { KURTOSIS_CREATE_ENCLAVE_URL_ARG } from "../constants";

export const CreateEnclaveButton = () => {
  const navigate = useNavigate();
  return (
    <>
      <Menu matchWidth>
        <MenuButton
          as={Button}
          colorScheme={"kurtosisGreen"}
          leftIcon={<FiPlus />}
          size={"md"}
          onClick={() => navigate(`#${KURTOSIS_CREATE_ENCLAVE_URL_ARG}`)}
        >
          New Enclave
        </MenuButton>
        {/*<MenuList>*/}
        {/*  <MenuItem onClick={() => navigate(`#${KURTOSIS_CREATE_ENCLAVE_URL_ARG}`)} icon={<FiSettings />}>*/}
        {/*    Manual*/}
        {/*  </MenuItem>*/}
        {/*  <MenuItem onClick={() => navigate("/catalog")} icon={<FiPackage />}>*/}
        {/*    Catalog*/}
        {/*  </MenuItem>*/}
        {/*</MenuList>*/}
      </Menu>
    </>
  );
};